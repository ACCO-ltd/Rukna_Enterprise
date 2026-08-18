import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { CommercialService } from './commercial.service.js';

function identityWith(permissions: string[]): RequestIdentity {
  return {
    userId: 'user-1',
    activeOrganizationId: 'org-1',
    tenantSlug: 'acco',
    roles: [],
    permissions,
    lang: 'en',
  };
}

const financeIdentity = identityWith([
  PERMISSIONS.contractsView,
  PERMISSIONS.financialPositionView,
]);
const noFinanceIdentity = identityWith([PERMISSIONS.contractsView]);

const baseContract = {
  id: 'c-1',
  contractNumber: 'CN-1',
  status: 'ACTIVE',
  currency: 'USD',
  contractValue: new Decimal('1000000'),
  billingModel: 'MEASURED_IPC',
  boqVersionId: 'boq-v-1',
  clientNameSnapshot: 'ACCO',
  client: { id: 'client-1', name: 'ACCO' },
  startDate: new Date('2026-01-01'),
  expectedEndDate: new Date('2026-12-31'),
  retentionTerms: null,
  advanceTerms: [],
  guarantees: [],
  milestones: [],
};

function build(overrides: {
  contract?: unknown;
  certs?: unknown;
  invoices?: unknown;
  applications?: unknown;
  certRejects?: boolean;
  boqVersionNumber?: number | null;
  applicationCount?: number;
  installments?: unknown;
}) {
  const repo = {
    findMainContract: jest
      .fn()
      .mockResolvedValue('contract' in overrides ? overrides.contract : baseContract),
    findPaymentInstallments: jest.fn().mockResolvedValue(overrides.installments ?? []),
    findEffectiveCertificates: overrides.certRejects
      ? jest.fn().mockRejectedValue(new Error('db down'))
      : jest.fn().mockResolvedValue(overrides.certs ?? []),
    findInvoices: jest.fn().mockResolvedValue(overrides.invoices ?? []),
    findApplicationsWithCertificates: jest.fn().mockResolvedValue(overrides.applications ?? []),
    findRecentActivity: jest.fn().mockResolvedValue([]),
    findBoqVersionNumber: jest.fn().mockResolvedValue(overrides.boqVersionNumber ?? 3),
    countSubmittedApplications: jest.fn().mockResolvedValue(overrides.applicationCount ?? 0),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const tenancy = { getClient: () => ({}) };
  const service = new CommercialService(tenancy as never, projectAccess as never, repo as never);
  return { repo, service };
}

describe('ADR-023 — getCurrentCycle for a MILESTONE contract', () => {
  const milestoneContract = { ...baseContract, billingModel: 'MILESTONE' };
  const accoPlan = [
    { id: 'i0', sortOrder: 0, name: 'Advance', percentage: new Decimal('0.4'), triggerType: 'ADVANCE', milestoneLabel: null, dueOffsetDays: null, dueDate: null },
    { id: 'i1', sortOrder: 1, name: 'Structure', percentage: new Decimal('0.3'), triggerType: 'MILESTONE', milestoneLabel: 'Structure', dueOffsetDays: null, dueDate: null },
    { id: 'i2', sortOrder: 2, name: 'Partition & Plastering', percentage: new Decimal('0.2'), triggerType: 'MILESTONE', milestoneLabel: 'Partition', dueOffsetDays: null, dueDate: null },
    { id: 'i3', sortOrder: 3, name: 'Installation & Paint', percentage: new Decimal('0.1'), triggerType: 'MILESTONE', milestoneLabel: 'Install', dueOffsetDays: null, dueDate: null },
  ];
  // The advance installment (i0) is invoiced and fully collected (outstanding 0).
  const advancePaidInvoices = [
    { id: 'inv-1', sourceInstallmentId: 'i0', postingStatus: 'POSTED', totalAmount: new Decimal('400000'), outstandingAmount: new Decimal('0'), allocations: [{ allocatedAmount: new Decimal('400000') }] },
  ];

  it('returns MILESTONE_SCHEDULE with the plan, not the IPA chain', async () => {
    const { service } = build({ contract: milestoneContract, installments: accoPlan, invoices: advancePaidInvoices });
    const res = await service.getCurrentCycle(financeIdentity, 'p-1');
    expect(res.stage).toBe('MILESTONE_SCHEDULE');
    expect(res.application).toBeNull();
    expect(res.paymentSchedule?.installments).toHaveLength(4);
  });

  it('derives status per installment from its own invoice: advance PAID, structure NEXT, rest UPCOMING', async () => {
    const { service } = build({ contract: milestoneContract, installments: accoPlan, invoices: advancePaidInvoices });
    const res = await service.getCurrentCycle(financeIdentity, 'p-1');
    const s = res.paymentSchedule!.installments;
    expect(s.map((i) => i.status)).toEqual(['PAID', 'NEXT', 'UPCOMING', 'UPCOMING']);
    expect(s[0].amount).toBe('400000.00');
    expect(s[0].amountPaid).toBe('400000.00');
    expect(s[1].amount).toBe('300000.00');
    expect(s[1].amountPaid).toBe('0.00');
  });

  it('marks an invoiced-but-unpaid installment BILLED (invoice raised, not posted)', async () => {
    const invoices = [
      ...advancePaidInvoices,
      // Structure (i1) invoiced but not yet posted → collected fraction 0 → BILLED.
      { id: 'inv-2', sourceInstallmentId: 'i1', postingStatus: 'NOT_POSTED', totalAmount: new Decimal('300000'), outstandingAmount: new Decimal('300000'), allocations: [] },
    ];
    const { service } = build({ contract: milestoneContract, installments: accoPlan, invoices });
    const res = await service.getCurrentCycle(financeIdentity, 'p-1');
    const s = res.paymentSchedule!.installments;
    // Advance PAID, Structure BILLED, then the first un-invoiced (Partition) is NEXT.
    expect(s.map((i) => i.status)).toEqual(['PAID', 'BILLED', 'NEXT', 'UPCOMING']);
  });

  it('hides money but keeps the plan structure without financial permission', async () => {
    const { service } = build({ contract: milestoneContract, installments: accoPlan, invoices: advancePaidInvoices });
    const res = await service.getCurrentCycle(noFinanceIdentity, 'p-1');
    expect(res.stage).toBe('MILESTONE_SCHEDULE');
    expect(res.paymentSchedule?.contractValue).toBeNull();
    expect(res.paymentSchedule?.installments[0].amount).toBeNull();
    // Structure (percentage + status) stays visible.
    expect(res.paymentSchedule?.installments[0].percentage).toBe('0.4');
    expect(res.paymentSchedule?.installments[0].status).toBe('PAID');
  });
});

describe('CommercialService.getSummary', () => {
  it('reports UNAVAILABLE (not zero) and NO_MAIN_CONTRACT when there is no contract', async () => {
    const { service } = build({ contract: null });
    const res = await service.getSummary(financeIdentity, 'p-1');
    expect(res.mainContract).toBeNull();
    expect(res.metrics.contractValue.state).toBe('UNAVAILABLE');
    expect(res.metrics.certifiedGross.state).toBe('UNAVAILABLE');
    expect(res.attention.map((a) => a.kind)).toContain('NO_MAIN_CONTRACT');
  });

  it('computes certified, invoiced, received and outstanding from posted AR (CONST-COM-004)', async () => {
    const { service } = build({
      certs: [
        {
          id: 'ipc-1',
          certifiedTotal: new Decimal('500000'),
          deductions: [{ amount: new Decimal('50000') }],
        },
      ],
      invoices: [
        {
          id: 'inv-1',
          sourceIpcId: 'ipc-1',
          invoiceNumber: 'INV-1',
          documentStatus: 'APPROVED',
          postingStatus: 'POSTED',
          totalAmount: new Decimal('525000'),
          outstandingAmount: new Decimal('325000'),
          invoiceDate: new Date('2026-07-01'),
          dueDate: new Date('2026-07-31'),
          currencyCode: 'USD',
          allocations: [{ allocatedAmount: new Decimal('200000') }],
        },
      ],
    });
    const res = await service.getSummary(financeIdentity, 'p-1');

    expect(res.metrics.contractValue).toMatchObject({
      state: 'OK',
      amount: '1000000.00',
      currency: 'USD',
    });
    expect(res.metrics.certifiedGross).toMatchObject({
      state: 'OK',
      amount: '500000.00',
      sourceCount: 1,
    });
    expect(res.metrics.certifiedNet.amount).toBe('450000.00');
    expect(res.metrics.invoiced).toMatchObject({ state: 'OK', amount: '525000.00' });
    expect(res.metrics.received).toMatchObject({ state: 'OK', amount: '200000.00' });
    expect(res.metrics.outstanding.amount).toBe('325000.00');
  });

  it('reports ZERO (not FAILED) when queries succeed but there is no certified/invoiced data', async () => {
    const { service } = build({ certs: [], invoices: [] });
    const res = await service.getSummary(financeIdentity, 'p-1');
    expect(res.metrics.certifiedGross.state).toBe('ZERO');
    expect(res.metrics.invoiced.state).toBe('ZERO');
  });

  it('restricts every money metric without FP (financial-position) permission', async () => {
    const { service } = build({
      certs: [{ id: 'ipc-1', certifiedTotal: new Decimal('500000'), deductions: [] }],
    });
    const res = await service.getSummary(noFinanceIdentity, 'p-1');
    expect(res.financialsVisible).toBe(false);
    for (const key of Object.keys(res.metrics) as (keyof typeof res.metrics)[]) {
      expect(res.metrics[key].state).toBe('RESTRICTED');
      expect(res.metrics[key].amount).toBeNull();
    }
  });

  it('marks metrics FAILED and raises RECONCILIATION_FAILED on partial query failure', async () => {
    const { service } = build({ certRejects: true });
    const res = await service.getSummary(financeIdentity, 'p-1');
    expect(res.metrics.certifiedGross.state).toBe('FAILED');
    expect(res.metrics.certifiedGross.amount).toBeNull();
    expect(res.attention.map((a) => a.kind)).toContain('RECONCILIATION_FAILED');
  });

  it('derives guarantee attention and raises an expiry item', async () => {
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 10);
    const { service } = build({
      contract: {
        ...baseContract,
        guarantees: [
          {
            id: 'g-1',
            guaranteeType: 'PERFORMANCE',
            issuer: 'Bank',
            beneficiary: 'ACCO',
            amount: new Decimal('100000'),
            currency: 'USD',
            issueDate: new Date('2026-01-01'),
            expiryDate: soon,
            status: 'ACTIVE',
          },
        ],
      },
    });
    const res = await service.getSummary(financeIdentity, 'p-1');
    expect(res.guarantees[0].attention).toBe('EXPIRING_SOON');
    expect(res.attention.map((a) => a.kind)).toContain('GUARANTEE_EXPIRING');
  });

  it('flags an effective certificate with no invoice as UNINVOICED_CERTIFICATE', async () => {
    const { service } = build({
      certs: [{ id: 'ipc-1', certifiedTotal: new Decimal('500000'), deductions: [] }],
      invoices: [],
    });
    const res = await service.getSummary(financeIdentity, 'p-1');
    expect(res.attention.map((a) => a.kind)).toContain('UNINVOICED_CERTIFICATE');
  });

  /**
   * Certified work nobody has asked to be paid for. It is derived from the same effective
   * set as certifiedNet, so the two can never tell different stories about one certificate.
   */
  it('sums certified net on effective certificates with no posted invoice', async () => {
    const { service } = build({
      certs: [
        {
          id: 'ipc-1',
          certifiedTotal: new Decimal('300000'),
          deductions: [{ amount: new Decimal('30000') }],
        },
        { id: 'ipc-2', certifiedTotal: new Decimal('200000'), deductions: [] },
      ],
      invoices: [
        {
          id: 'inv-1',
          sourceIpcId: 'ipc-1',
          invoiceNumber: 'INV-1',
          documentStatus: 'APPROVED',
          postingStatus: 'POSTED',
          totalAmount: new Decimal('270000'),
          outstandingAmount: new Decimal('0'),
          invoiceDate: new Date('2026-07-01'),
          dueDate: new Date('2026-07-31'),
          currencyCode: 'USD',
          allocations: [{ allocatedAmount: new Decimal('270000') }],
        },
      ],
    });
    const res = await service.getSummary(financeIdentity, 'p-1');

    // ipc-2 only: 200,000 with no deductions and no invoice behind it.
    expect(res.metrics.uninvoicedCertified).toMatchObject({
      state: 'OK',
      amount: '200000.00',
      sourceCount: 1,
    });
  });

  it('counts the certification chain, and keeps the counts readable without financial access', async () => {
    const { service } = build({
      applicationCount: 9,
      certs: [
        { id: 'ipc-1', certifiedTotal: new Decimal('1'), deductions: [] },
        { id: 'ipc-2', certifiedTotal: new Decimal('1'), deductions: [] },
      ],
      invoices: [
        {
          id: 'inv-1',
          sourceIpcId: 'ipc-1',
          invoiceNumber: 'INV-1',
          documentStatus: 'APPROVED',
          postingStatus: 'POSTED',
          totalAmount: new Decimal('1'),
          outstandingAmount: new Decimal('0'),
          invoiceDate: new Date('2026-07-01'),
          dueDate: new Date('2026-07-31'),
          currencyCode: 'USD',
          allocations: [],
        },
      ],
    });

    const res = await service.getSummary(financeIdentity, 'p-1');
    expect(res.certification).toEqual({
      applicationsSubmitted: 9,
      effectiveCertificates: 2,
      postedInvoices: 1,
    });

    // How many documents exist is not a commercial secret; what they are worth is.
    const restricted = await service.getSummary(noFinanceIdentity, 'p-1');
    expect(restricted.certification.effectiveCertificates).toBe(2);
    expect(restricted.metrics.uninvoicedCertified.state).toBe('RESTRICTED');
  });

  it('lists outstanding posted invoices soonest-due first, with overdue days off the server clock', async () => {
    const now = new Date();
    const sixDaysAgo = new Date(now);
    sixDaysAgo.setUTCDate(sixDaysAgo.getUTCDate() - 6);
    const inTwoWeeks = new Date(now);
    inTwoWeeks.setUTCDate(inTwoWeeks.getUTCDate() + 14);

    const { service } = build({
      invoices: [
        {
          id: 'inv-late',
          sourceIpcId: null,
          invoiceNumber: 'INV-2026-005',
          documentStatus: 'APPROVED',
          postingStatus: 'POSTED',
          totalAmount: new Decimal('70000'),
          outstandingAmount: new Decimal('70000'),
          invoiceDate: new Date('2026-07-10'),
          dueDate: sixDaysAgo,
          currencyCode: 'USD',
          allocations: [],
        },
        {
          id: 'inv-soon',
          sourceIpcId: null,
          invoiceNumber: 'INV-2026-007',
          documentStatus: 'APPROVED',
          postingStatus: 'POSTED',
          totalAmount: new Decimal('310000'),
          outstandingAmount: new Decimal('310000'),
          invoiceDate: new Date('2026-07-28'),
          dueDate: inTwoWeeks,
          currencyCode: 'USD',
          allocations: [],
        },
        {
          id: 'inv-settled',
          sourceIpcId: null,
          invoiceNumber: 'INV-2026-004',
          documentStatus: 'APPROVED',
          postingStatus: 'POSTED',
          totalAmount: new Decimal('50000'),
          outstandingAmount: new Decimal('0'),
          invoiceDate: new Date('2026-06-01'),
          dueDate: new Date('2026-06-30'),
          currencyCode: 'USD',
          allocations: [{ allocatedAmount: new Decimal('50000') }],
        },
      ],
    });
    const res = await service.getSummary(financeIdentity, 'p-1');

    // Settled invoices are not outstanding; the latest due date is not the most urgent.
    expect(res.receivables.outstandingInvoices.map((i) => i.invoiceNumber)).toEqual([
      'INV-2026-005',
      'INV-2026-007',
    ]);
    expect(res.receivables.outstandingInvoices[0]!.daysOverdue).toBe(6);
    expect(res.receivables.outstandingInvoices[1]!.daysOverdue).toBe(0);
    // 430,000 invoiced, 50,000 received.
    expect(res.receivables.collectionRate).toBe(12);
  });

  it('withholds the contract value and the receivables list without financial access', async () => {
    const { service } = build({
      invoices: [
        {
          id: 'inv-1',
          sourceIpcId: null,
          invoiceNumber: 'INV-1',
          documentStatus: 'APPROVED',
          postingStatus: 'POSTED',
          totalAmount: new Decimal('100'),
          outstandingAmount: new Decimal('100'),
          invoiceDate: new Date('2026-07-01'),
          dueDate: new Date('2026-07-31'),
          currencyCode: 'USD',
          allocations: [],
        },
      ],
    });
    const res = await service.getSummary(noFinanceIdentity, 'p-1');

    // The identity panel must not leak the figure the metric one card away is hiding.
    expect(res.mainContract?.contractValue).toBeNull();
    expect(res.receivables.outstandingInvoices).toEqual([]);
    expect(res.receivables.collectionRate).toBeNull();
  });

  it('carries the contract identity the Main Contract panel states', async () => {
    const { service } = build({ boqVersionNumber: 3 });
    const res = await service.getSummary(financeIdentity, 'p-1');

    expect(res.mainContract).toMatchObject({
      contractNumber: 'CN-1',
      billingModel: 'MEASURED_IPC',
      boqVersionNumber: 3,
      currency: 'USD',
      contractValue: '1000000',
    });
  });
});

describe('CommercialService capabilities (B4)', () => {
  it('gates canEditContract by lifecycle: false on ACTIVE even with manage permission', async () => {
    const { service } = build({ contract: { ...baseContract, status: 'ACTIVE' } });
    const res = await service.getSummary(
      identityWith([PERMISSIONS.contractsView, PERMISSIONS.contractsManage]),
      'p-1',
    );
    expect(res.capabilities.canEditContract).toBe(false);
  });

  it('allows canEditContract on DRAFT with manage permission', async () => {
    const { service } = build({ contract: { ...baseContract, status: 'DRAFT' } });
    const res = await service.getSummary(
      identityWith([PERMISSIONS.contractsView, PERMISSIONS.contractsManage]),
      'p-1',
    );
    expect(res.capabilities.canEditContract).toBe(true);
  });
});

describe('CommercialService.getApplications', () => {
  it('builds the IPA→IPC→invoice→settlement chain with next action', async () => {
    const { service } = build({
      applications: [
        {
          id: 'ipa-1',
          applicationNumber: 1,
          applicationRef: 'IPA-001',
          status: 'SUBMITTED',
          periodFrom: new Date('2026-02-01'),
          periodTo: new Date('2026-02-28'),
          items: [{ periodAmount: new Decimal('500000') }],
          certificates: [
            {
              id: 'ipc-1',
              status: 'CERTIFIED',
              isEffective: true,
              certifiedTotal: new Decimal('480000'),
              deductions: [{ amount: new Decimal('48000') }],
            },
            {
              id: 'ipc-0',
              status: 'CERTIFIED',
              isEffective: false,
              certifiedTotal: new Decimal('400000'),
              deductions: [],
            },
          ],
        },
      ],
      invoices: [
        {
          id: 'inv-1',
          sourceIpcId: 'ipc-1',
          invoiceNumber: 'INV-1',
          documentStatus: 'APPROVED',
          postingStatus: 'POSTED',
          totalAmount: new Decimal('504000'),
          currencyCode: 'USD',
          allocations: [{ allocatedAmount: new Decimal('100000') }],
        },
      ],
    });
    const res = await service.getApplications(financeIdentity, 'p-1');
    const row = res.applications[0];
    expect(row.certifiedGross).toBe('480000.00');
    expect(row.certifiedNet).toBe('432000.00');
    expect(row.supersededCertificateCount).toBe(1);
    expect(row.invoicedAmount).toBe('504000.00');
    expect(row.receivedAmount).toBe('100000.00');
    expect(row.outstandingAmount).toBe('404000.00');
    expect(row.settlement).toBe('PARTIALLY_PAID');
    expect(row.nextAction).toBe('RECORD_RECEIPT');
  });

  it('nulls money fields but keeps the chain shape when financials are restricted', async () => {
    const { service } = build({
      applications: [
        {
          id: 'ipa-1',
          applicationNumber: 1,
          applicationRef: 'IPA-001',
          status: 'DRAFT',
          periodFrom: null,
          periodTo: null,
          items: [{ periodAmount: new Decimal('500000') }],
          certificates: [],
        },
      ],
    });
    const res = await service.getApplications(noFinanceIdentity, 'p-1');
    const row = res.applications[0];
    expect(row.claimedAmount).toBeNull();
    expect(row.settlement).toBe('UNINVOICED');
    expect(row.nextAction).toBe('SUBMIT_APPLICATION');
  });
});

describe('CommercialService.getCurrentCycle', () => {
  it('makes an active contract with no applications actionable', async () => {
    const { service } = build({ applications: [] });
    const result = await service.getCurrentCycle(
      identityWith([PERMISSIONS.contractsView, PERMISSIONS.ipaCreate]),
      'p-1',
    );

    expect(result).toMatchObject({
      stage: 'READY_FOR_APPLICATION',
      application: null,
      blockers: [],
      responsibleRole: 'QUANTITY_SURVEYOR',
      nextAction: {
        kind: 'CREATE_APPLICATION',
        href: '/contracts/c-1/applications/new',
      },
    });
  });

  it('distinguishes approval from submission to the client', async () => {
    const { service } = build({
      applications: [
        {
          id: 'ipa-1',
          applicationNumber: 1,
          applicationRef: 'IPA-001',
          status: 'APPROVED_FOR_SUBMISSION',
          periodFrom: null,
          periodTo: null,
          items: [],
          certificates: [],
        },
      ],
    });
    const result = await service.getCurrentCycle(
      identityWith([PERMISSIONS.contractsView, PERMISSIONS.ipaManage]),
      'p-1',
    );

    expect(result.nextAction).toMatchObject({
      kind: 'SUBMIT_APPLICATION',
      href: '/contracts/c-1/applications/ipa-1',
    });
  });

  it('does not route settlement into the legacy receipt ledger', async () => {
    const { service } = build({
      applications: [
        {
          id: 'ipa-1',
          applicationNumber: 1,
          applicationRef: 'IPA-001',
          status: 'SUBMITTED',
          periodFrom: null,
          periodTo: null,
          items: [],
          certificates: [
            {
              id: 'ipc-1',
              status: 'CERTIFIED',
              isEffective: true,
              certifiedTotal: new Decimal('100'),
              deductions: [],
            },
          ],
        },
      ],
      invoices: [
        {
          id: 'inv-1',
          sourceIpcId: 'ipc-1',
          invoiceNumber: 'INV-1',
          documentStatus: 'APPROVED',
          postingStatus: 'POSTED',
          totalAmount: new Decimal('100'),
          outstandingAmount: new Decimal('100'),
          invoiceDate: new Date('2026-08-01'),
          dueDate: new Date('2026-08-31'),
          currencyCode: 'USD',
          allocations: [],
        },
      ],
    });
    const result = await service.getCurrentCycle(
      identityWith([PERMISSIONS.contractsView, PERMISSIONS.receiptsCreate]),
      'p-1',
    );

    expect(result.stage).toBe('AWAITING_PAYMENT');
    expect(result.nextAction).toBeNull();
    expect(result.blockers).toContain('RECEIPT_WORKFLOW_UNAVAILABLE');
  });
});
