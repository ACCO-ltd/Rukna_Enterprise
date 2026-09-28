import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type CommercialTodoItem } from '@erp/types';

import {
  buildStatementLines,
  daysPastDue,
  deriveExpectedDate,
  deriveInvoiceState,
  deriveReleasedBy,
  invoiceDocumentCapabilities,
  invoiceLifecycle,
  overdueDays,
  parsePaymentTermsDays,
  rankTodo,
  resolveInvoiceDates,
  shortContractRef,
  taxLabelFor,
  workspaceCapabilities,
} from './commercial-workspace.policy.js';

const d = (s: string) => new Date(s);

describe('commercial-workspace.policy — the one overdue rule', () => {
  it('counts whole UTC calendar days, ignoring the time of day', () => {
    expect(daysPastDue(d('2026-09-20'), d('2026-09-28T23:59:00Z'))).toBe(8);
    expect(daysPastDue(d('2026-09-28'), d('2026-09-28T00:01:00Z'))).toBe(0);
    expect(daysPastDue(d('2026-09-30'), d('2026-09-28T12:00:00Z'))).toBe(-2);
  });

  it('is overdue only when posted, past due and carrying a balance', () => {
    const asOf = d('2026-09-28T10:00:00Z');
    expect(overdueDays({ posted: true, dueDate: d('2026-09-25'), balance: new Decimal(10) }, asOf)).toBe(3);
    expect(overdueDays({ posted: false, dueDate: d('2026-09-25'), balance: new Decimal(10) }, asOf)).toBe(0);
    expect(overdueDays({ posted: true, dueDate: d('2026-09-25'), balance: new Decimal(0) }, asOf)).toBe(0);
    expect(overdueDays({ posted: true, dueDate: null, balance: new Decimal(10) }, asOf)).toBe(0);
    expect(overdueDays({ posted: true, dueDate: d('2026-09-28'), balance: new Decimal(10) }, asOf)).toBe(0);
  });
});

describe('commercial-workspace.policy — releasedBy / expectedDate (D4)', () => {
  const pm = {
    id: 'pm1',
    code: 'M-02',
    name: 'Structure',
    status: 'PLANNED',
    baselineDate: d('2026-10-01'),
    forecastDate: d('2026-10-15'),
    actualDate: null,
    verifiedAt: null,
  };

  it('ADVANCE: released by the advance, no expected date', () => {
    const inst = { triggerType: 'ADVANCE', dueDate: null, programmeMilestone: null };
    expect(deriveReleasedBy(inst)).toEqual({ kind: 'ADVANCE' });
    expect(deriveExpectedDate(inst)).toBeNull();
  });

  it('MILESTONE: forecast wins over baseline; verifiedAt null while not verified', () => {
    const inst = { triggerType: 'MILESTONE', dueDate: null, programmeMilestone: pm };
    expect(deriveExpectedDate(inst)).toBe('2026-10-15');
    expect(deriveReleasedBy(inst)).toEqual({
      kind: 'MILESTONE',
      milestoneId: 'pm1',
      milestoneCode: 'M-02',
      milestoneName: 'Structure',
      verifiedAt: null,
    });
  });

  it('MILESTONE: baseline when no forecast; verifiedAt from the verification stamp, else actualDate', () => {
    const verified = { ...pm, forecastDate: null, status: 'VERIFIED', verifiedAt: d('2026-10-02T09:00:00Z') };
    const inst = { triggerType: 'MILESTONE', dueDate: null, programmeMilestone: verified };
    expect(deriveExpectedDate(inst)).toBe('2026-10-01');
    expect(deriveReleasedBy(inst)).toMatchObject({ verifiedAt: '2026-10-02T09:00:00.000Z' });
    const legacy = { ...verified, verifiedAt: null, actualDate: d('2026-10-03') };
    expect(deriveReleasedBy({ ...inst, programmeMilestone: legacy })).toMatchObject({
      verifiedAt: '2026-10-03T00:00:00.000Z',
    });
  });

  it('MILESTONE unlinked: all-null milestone reference', () => {
    const inst = { triggerType: 'MILESTONE', dueDate: null, programmeMilestone: null };
    expect(deriveReleasedBy(inst)).toEqual({
      kind: 'MILESTONE',
      milestoneId: null,
      milestoneCode: null,
      milestoneName: null,
      verifiedAt: null,
    });
    expect(deriveExpectedDate(inst)).toBeNull();
  });

  it('TIME_BASED: released by and expected on the due date', () => {
    const inst = { triggerType: 'TIME_BASED', dueDate: d('2026-12-31'), programmeMilestone: null };
    expect(deriveReleasedBy(inst)).toEqual({ kind: 'DATE', date: '2026-12-31' });
    expect(deriveExpectedDate(inst)).toBe('2026-12-31');
  });
});

describe('commercial-workspace.policy — invoice state and lifecycle', () => {
  it('schedule invoiceState: DRAFT until posted, ISSUED after, null when none/cancelled', () => {
    expect(deriveInvoiceState(null)).toBeNull();
    expect(deriveInvoiceState({ documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' })).toBe('DRAFT');
    expect(deriveInvoiceState({ documentStatus: 'APPROVED', postingStatus: 'FAILED' })).toBe('DRAFT');
    expect(deriveInvoiceState({ documentStatus: 'APPROVED', postingStatus: 'POSTED' })).toBe('ISSUED');
    expect(deriveInvoiceState({ documentStatus: 'CANCELLED', postingStatus: 'NOT_POSTED' })).toBeNull();
  });

  it('lifecycle DRAFT → ISSUED → SENT → PAID, CANCELLED for cancelled or reversed', () => {
    const base = { documentStatus: 'APPROVED', postingStatus: 'POSTED', balance: new Decimal(100), deliveryCount: 0 };
    expect(invoiceLifecycle({ ...base, documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' })).toBe('DRAFT');
    expect(invoiceLifecycle(base)).toBe('ISSUED');
    expect(invoiceLifecycle({ ...base, deliveryCount: 1 })).toBe('SENT');
    expect(invoiceLifecycle({ ...base, deliveryCount: 1, balance: new Decimal(0) })).toBe('PAID');
    expect(invoiceLifecycle({ ...base, documentStatus: 'CANCELLED' })).toBe('CANCELLED');
    expect(invoiceLifecycle({ ...base, postingStatus: 'REVERSED' })).toBe('CANCELLED');
  });
});

describe('commercial-workspace.policy — capabilities', () => {
  const biller = [PERMISSIONS.contractsView, PERMISSIONS.receivablesManage];
  const active = { status: 'ACTIVE', billingModel: 'MILESTONE' };

  it('workspace: canBill needs view:contract + manage:receivable; payment also needs ACTIVE', () => {
    expect(workspaceCapabilities(biller, active, true)).toMatchObject({ canBill: true, canRecordPayment: true });
    expect(workspaceCapabilities([PERMISSIONS.receivablesManage], active, true)).toMatchObject({
      canBill: false,
      canRecordPayment: false,
    });
    expect(workspaceCapabilities(biller, { ...active, status: 'DRAFT' }, true).canRecordPayment).toBe(false);
  });

  it('workspace: record contract only with create+approve and no contract; reopen only when ACTIVE', () => {
    const perms = [PERMISSIONS.contractsCreate, PERMISSIONS.contractsApprove];
    expect(workspaceCapabilities(perms, null, false).canRecordContract).toBe(true);
    expect(workspaceCapabilities(perms, active, false).canRecordContract).toBe(false);
    expect(workspaceCapabilities([PERMISSIONS.contractsCreate], null, false).canRecordContract).toBe(false);
    expect(workspaceCapabilities(perms, active, false).canReopenContract).toBe(true);
    expect(workspaceCapabilities(perms, { ...active, status: 'DRAFT' }, false).canReopenContract).toBe(false);
  });

  it('workspace: manage:contract for signed date / re-profile (MILESTONE, not terminal); statement needs money', () => {
    const mgr = [PERMISSIONS.contractsManage];
    expect(workspaceCapabilities(mgr, active, false)).toMatchObject({
      canRecordSignedDate: true,
      canReprofileSchedule: true,
      canExportStatement: false,
    });
    expect(workspaceCapabilities(mgr, { status: 'CLOSED', billingModel: 'MILESTONE' }, true)).toMatchObject({
      canRecordSignedDate: false,
      canReprofileSchedule: false,
      canExportStatement: true,
    });
    expect(workspaceCapabilities(mgr, { ...active, billingModel: 'MEASURED_IPC' }, true).canReprofileSchedule).toBe(false);
    expect(workspaceCapabilities(mgr, null, true).canExportStatement).toBe(false);
  });

  it('invoice document: by state and permission', () => {
    const draft = invoiceDocumentCapabilities(biller, 'DRAFT', new Decimal(100));
    expect(draft).toEqual({
      canIssue: true,
      canSend: false,
      canRecordPayment: false,
      canEditDraft: true,
      canDeleteDraft: true,
      canIssueCreditNote: false,
      canDownloadPdf: true,
    });
    const sent = invoiceDocumentCapabilities(biller, 'SENT', new Decimal(100));
    expect(sent).toMatchObject({ canIssue: false, canSend: true, canRecordPayment: true, canIssueCreditNote: true });
    expect(invoiceDocumentCapabilities(biller, 'PAID', new Decimal(0)).canRecordPayment).toBe(false);
    const viewer = invoiceDocumentCapabilities([PERMISSIONS.contractsView], 'DRAFT', new Decimal(100));
    expect(viewer).toMatchObject({ canIssue: false, canDeleteDraft: false, canDownloadPdf: true });
    expect(invoiceDocumentCapabilities(biller, 'CANCELLED', new Decimal(0))).toMatchObject({
      canIssue: false,
      canSend: false,
      canDeleteDraft: false,
    });
  });
});

describe('commercial-workspace.policy — To do ranking', () => {
  const item = (p: Partial<CommercialTodoItem> & Pick<CommercialTodoItem, 'id' | 'kind'>): CommercialTodoItem => ({
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
    ...p,
  });

  it('orders overdue (most late first) → ready (stage order) → draft (oldest) → unsent → one blocked', () => {
    const ranked = rankTodo([
      item({ id: 'blocked:5', kind: 'BLOCKED_STAGE', stageNumber: 5 }),
      item({ id: 'unsent:b', kind: 'ISSUED_NOT_SENT', dueDate: '2026-10-20' }),
      item({ id: 'draft:new', kind: 'DRAFT_INVOICE', createdAt: '2026-09-27T10:00:00Z' }),
      item({ id: 'ready:3', kind: 'READY_TO_INVOICE', stageNumber: 3 }),
      item({ id: 'overdue:a', kind: 'OVERDUE_INVOICE', daysOverdue: 4 }),
      item({ id: 'unsent:a', kind: 'ISSUED_NOT_SENT', dueDate: '2026-10-10' }),
      item({ id: 'ready:2', kind: 'READY_TO_INVOICE', stageNumber: 2 }),
      item({ id: 'draft:old', kind: 'DRAFT_INVOICE', createdAt: '2026-09-01T10:00:00Z' }),
      item({ id: 'overdue:b', kind: 'OVERDUE_INVOICE', daysOverdue: 40 }),
      item({ id: 'blocked:6', kind: 'BLOCKED_STAGE', stageNumber: 6 }),
    ]);
    expect(ranked.map((i) => i.id)).toEqual([
      'overdue:b',
      'overdue:a',
      'ready:2',
      'ready:3',
      'draft:old',
      'draft:new',
      'unsent:a',
      'unsent:b',
      'blocked:5',
    ]);
  });
});

describe('commercial-workspace.policy — small derivations', () => {
  it('shortContractRef: suffix after the project code, else a trailing C<n>, else the number', () => {
    expect(shortContractRef('ACC-HDN-26-0005-C1', 'ACC-HDN-26-0005')).toBe('C1');
    expect(shortContractRef('ACC-HDN-26-0005-C2', null)).toBe('C2');
    expect(shortContractRef('ACCO-2026-77', 'OTHER')).toBe('ACCO-2026-77');
  });

  it('parsePaymentTermsDays: the first number, else null', () => {
    expect(parsePaymentTermsDays('Net 30')).toBe(30);
    expect(parsePaymentTermsDays('45 days')).toBe(45);
    expect(parsePaymentTermsDays('On receipt')).toBeNull();
    expect(parsePaymentTermsDays(null)).toBeNull();
  });

  it('resolveInvoiceDates: defaults to server today + terms; refuses due before invoice', () => {
    const today = d('2026-09-28T15:00:00Z');
    expect(resolveInvoiceDates({}, 'Net 30', today)).toMatchObject({
      invoiceDate: '2026-09-28',
      dueDate: '2026-10-28',
      termsDays: 30,
      error: null,
    });
    expect(resolveInvoiceDates({ paymentTermsDays: 7, invoiceDate: '2026-10-01' }, 'Net 30', today)).toMatchObject({
      dueDate: '2026-10-08',
    });
    expect(resolveInvoiceDates({}, null, today).dueDate).toBe('2026-09-28');
    expect(resolveInvoiceDates({ invoiceDate: '2026-10-01', dueDate: '2026-09-30' }, null, today).error).not.toBeNull();
  });

  it('taxLabelFor: from the invoice amounts; null when untaxed', () => {
    expect(taxLabelFor(new Decimal(1000), new Decimal(50))).toBe('Sales tax 5%');
    expect(taxLabelFor(new Decimal(1000), new Decimal(0))).toBeNull();
  });
});

describe('commercial-workspace.policy — client statement', () => {
  it('runs the balance oldest first; same-day invoice precedes its credit/receipt', () => {
    const { lines, closingBalance } = buildStatementLines(
      [
        { date: d('2026-09-10'), kind: 'RECEIPT', reference: 'BNK-1', description: 'Payment', amount: new Decimal(400), sequence: 2 },
        { date: d('2026-09-01'), kind: 'INVOICE', reference: 'INV-1', description: 'Advance', amount: new Decimal(1050), sequence: 0 },
        { date: d('2026-09-10'), kind: 'INVOICE', reference: 'INV-2', description: 'Structure', amount: new Decimal(500), sequence: 1 },
        { date: d('2026-09-12'), kind: 'CREDIT_NOTE', reference: 'CN-1', description: 'Credit', amount: new Decimal(50), sequence: 3 },
      ],
      true,
    );
    expect(lines.map((l) => [l.reference, l.debit, l.credit, l.balance])).toEqual([
      ['INV-1', '1050.00', null, '1050.00'],
      ['INV-2', '500.00', null, '1550.00'],
      ['BNK-1', null, '400.00', '1150.00'],
      ['CN-1', null, '50.00', '1100.00'],
    ]);
    expect(closingBalance).toBe('1100.00');
  });

  it('nulls every money figure without financial visibility, keeping the rows', () => {
    const { lines, closingBalance } = buildStatementLines(
      [{ date: d('2026-09-01'), kind: 'INVOICE', reference: 'INV-1', description: 'x', amount: new Decimal(10), sequence: 0 }],
      false,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ debit: null, credit: null, balance: null, reference: 'INV-1' });
    expect(closingBalance).toBeNull();
  });
});
