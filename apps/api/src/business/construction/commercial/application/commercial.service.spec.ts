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
  variationInputs?: unknown;
  billingInvoices?: unknown;
  receipts?: unknown;
  clientUnapplied?: Decimal;
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
    findInvoicesForBilling: jest.fn().mockResolvedValue(overrides.billingInvoices ?? []),
    findReceiptsForContract: jest.fn().mockResolvedValue(overrides.receipts ?? []),
    sumClientUnappliedReceipts: jest
      .fn()
      .mockResolvedValue(overrides.clientUnapplied ?? new Decimal(0)),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const tenancy = { getClient: () => ({}) };
  // ADR-026: the commercial summary now derives contract value from the VO set. Default to none.
  const variationRepo = {
    findValuationInputs: jest.fn().mockResolvedValue(overrides.variationInputs ?? []),
  };
  const service = new CommercialService(
    tenancy as never,
    projectAccess as never,
    repo as never,
    variationRepo as never,
  );
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

  // ADR-029 T-6 — the milestone schedule derives from the FROZEN baseContractValue. A variation that
  // raised the current contractValue to 1.2M must NOT re-spread the 1M schedule.
  it('T-6: derives installment amounts from baseContractValue, not the raised current value', async () => {
    const varied = { ...milestoneContract, contractValue: new Decimal('1200000'), baseContractValue: new Decimal('1000000') };
    const { service } = build({ contract: varied, installments: accoPlan, invoices: [] });
    const res = await service.getCurrentCycle(financeIdentity, 'p-1');
    const s = res.paymentSchedule!.installments;
    // 40/30/20/10 of the 1M BASE — unchanged by the +200k on the current value.
    expect(s.map((i) => i.amount)).toEqual(['400000.00', '300000.00', '200000.00', '100000.00']);
    // The header value the % are read against is the base too, so Σ amounts = header.
    expect(res.paymentSchedule?.contractValue).toBe('1000000.00');
  });

  // ADR-029 M-4 — a legacy contract predates the split (null base). It must never fail; the schedule
  // falls back to contractValue.
  it('M-4: a legacy contract with a null base falls back to contractValue for the schedule', async () => {
    const legacy = { ...milestoneContract, baseContractValue: null };
    const { service } = build({ contract: legacy, installments: accoPlan, invoices: [] });
    const res = await service.getCurrentCycle(financeIdentity, 'p-1');
    expect(res.paymentSchedule!.installments[0].amount).toBe('400000.00');
    expect(res.paymentSchedule?.contractValue).toBe('1000000.00');
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
    expect(res.contractValue).toBeNull();
    expect(res.metrics.contractValue.state).toBe('UNAVAILABLE');
    expect(res.metrics.certifiedGross.state).toBe('UNAVAILABLE');
    expect(res.attention.map((a) => a.kind)).toContain('NO_MAIN_CONTRACT');
  });

  describe('ADR-026 — derived Original/Approved/Governing/Pending contract value', () => {
    // Each VO is (status, lines[amount]); net price is Σ amount.
    const variationInputs = [
      { id: 'v1', status: 'CLIENT_APPROVED', lines: [{ amount: new Decimal('50000') }] },
      { id: 'v2', status: 'CLIENT_APPROVED', lines: [{ amount: new Decimal('-20000') }] }, // omission
      { id: 'v3', status: 'INTERNAL_APPROVED', lines: [{ amount: new Decimal('30000') }] },
      { id: 'v4', status: 'PENDING_INTERNAL', lines: [{ amount: new Decimal('10000') }] },
      { id: 'v5', status: 'DRAFT', lines: [{ amount: new Decimal('99999') }] },
      { id: 'v6', status: 'REJECTED', lines: [{ amount: new Decimal('99999') }] },
    ];

    it('governing = original + Σ client-approved; pending sums PENDING+INTERNAL only; original untouched', async () => {
      const { service } = build({ variationInputs });
      const res = await service.getSummary(financeIdentity, 'p-1');
      expect(res.contractValue).toEqual({
        originalContractValue: '1000000.00',
        approvedVariationsTotal: '30000.00', // 50000 - 20000
        governingContractValue: '1030000.00',
        pendingVariations: '40000.00', // 30000 + 10000
      });
      // The immutable original metric card is unchanged by variations.
      expect(res.mainContract?.contractValue).toBe('1000000');
    });

    it('withholds the derived figures without financial visibility', async () => {
      const { service } = build({ variationInputs });
      const res = await service.getSummary(noFinanceIdentity, 'p-1');
      expect(res.contractValue).toEqual({
        originalContractValue: null,
        approvedVariationsTotal: null,
        governingContractValue: null,
        pendingVariations: null,
      });
    });

    it('with no variations, governing = original and pending = 0', async () => {
      const { service } = build({ variationInputs: [] });
      const res = await service.getSummary(financeIdentity, 'p-1');
      expect(res.contractValue?.governingContractValue).toBe('1000000.00');
      expect(res.contractValue?.pendingVariations).toBe('0.00');
    });
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

// ─── Billing & Collection ───────────────────────────────────────────────────────

/**
 * A client invoice as `findInvoicesForBilling` returns it. The defaults describe a posted,
 * unpaid invoice, so a test only has to state the thing it is actually about.
 */
function billingInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-0001',
    invoiceDate: new Date('2026-08-01'),
    dueDate: new Date('2026-08-31'),
    currencyCode: 'USD',
    subtotal: new Decimal('100000'),
    vatAmount: new Decimal('5000'),
    totalAmount: new Decimal('105000'),
    outstandingAmount: new Decimal('105000'),
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    sourceInstallmentId: null,
    sourceInstallment: null,
    sourceIpcId: null,
    sourceIpc: null,
    allocations: [],
    ...overrides,
  };
}

describe('getBilling — the invoice-total settlement basis', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-15T00:00:00.000Z'));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  /**
   * The error this read model exists to prevent: measuring collection against a pre-VAT figure.
   * A $105,000 invoice fully paid is 100% collected — not 105% of the $100,000 net behind it.
   */
  it('measures collection against the VAT-inclusive invoice total, not the net subtotal', async () => {
    const { service } = build({
      billingInvoices: [
        billingInvoice({
          outstandingAmount: new Decimal('0'),
          allocations: [
            {
              id: 'al-1',
              allocatedAmount: new Decimal('105000'),
              allocationDate: new Date('2026-09-01'),
              paymentReceiptId: 'r-1',
            },
          ],
        }),
      ],
    });

    const result = await service.getBilling(financeIdentity, 'p-1');

    expect(result.position.invoiced).toBe('105000.00');
    expect(result.position.collected).toBe('105000.00');
    expect(result.position.outstanding).toBe('0.00');
    expect(result.position.collectionRate).toBe(100);
    expect(result.invoices[0]!.status).toBe('PAID');
    // Both bases are carried so a screen showing them together can label which is which.
    expect(result.invoices[0]!.subtotal).toBe('100000.00');
    expect(result.invoices[0]!.vatAmount).toBe('5000.00');
  });

  /** A draft invoice is a document somebody is still writing, not a claim on the client. */
  it('counts only posted invoices toward the position', async () => {
    const { service } = build({
      billingInvoices: [
        billingInvoice({ id: 'inv-draft', documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' }),
        billingInvoice({ id: 'inv-posted' }),
      ],
    });

    const result = await service.getBilling(financeIdentity, 'p-1');

    expect(result.position.postedInvoiceCount).toBe(1);
    expect(result.position.invoiced).toBe('105000.00');
    expect(result.invoices).toHaveLength(2);
    expect(result.invoices.find((i) => i.id === 'inv-draft')!.status).toBe('DRAFT');
  });

  /** An approved invoice the GL has not taken yet is a normal step, not a settlement state. */
  it('distinguishes an approved-but-unposted invoice from an unpaid one', async () => {
    const { service } = build({
      billingInvoices: [billingInvoice({ postingStatus: 'NOT_POSTED' })],
    });
    const result = await service.getBilling(financeIdentity, 'p-1');
    expect(result.invoices[0]!.status).toBe('AWAITING_POSTING');
  });

  /** Lateness is measured against the server clock in whole UTC days, and the buckets follow it. */
  it('ages an overdue balance against the server clock', async () => {
    const { service } = build({
      billingInvoices: [billingInvoice({ dueDate: new Date('2026-08-31') })],
    });

    const result = await service.getBilling(financeIdentity, 'p-1');

    expect(result.invoices[0]!.daysOverdue).toBe(15);
    expect(result.position.overdue).toBe('105000.00');
    expect(result.position.overdueInvoiceCount).toBe(1);
    expect(result.aging.find((b) => b.bucket === 'DAYS_1_30')).toEqual({
      bucket: 'DAYS_1_30',
      amount: '105000.00',
      invoiceCount: 1,
    });
  });

  /** Not-yet-due money is outstanding but not late; it must not land in an overdue bucket. */
  it('puts a balance that is not yet due in NOT_DUE and out of overdue', async () => {
    const { service } = build({
      billingInvoices: [billingInvoice({ dueDate: new Date('2026-10-31') })],
    });

    const result = await service.getBilling(financeIdentity, 'p-1');

    expect(result.invoices[0]!.daysOverdue).toBe(0);
    expect(result.position.overdue).toBe('0.00');
    expect(result.aging.find((b) => b.bucket === 'NOT_DUE')!.amount).toBe('105000.00');
  });

  it('names the source document a reader recognises', async () => {
    const { service } = build({
      billingInvoices: [
        billingInvoice({
          id: 'inv-m',
          sourceInstallmentId: 'inst-3',
          sourceInstallment: { id: 'inst-3', name: 'Structural frame', sortOrder: 2 },
        }),
        billingInvoice({
          id: 'inv-c',
          sourceIpcId: 'ipc-6',
          sourceIpc: {
            id: 'ipc-6',
            application: { id: 'ipa-6', applicationRef: 'IPA-006', applicationNumber: 6 },
          },
        }),
        billingInvoice({ id: 'inv-migrated' }),
      ],
    });

    const result = await service.getBilling(financeIdentity, 'p-1');
    const byId = new Map(result.invoices.map((i) => [i.id, i.source]));

    expect(byId.get('inv-m')).toEqual({
      kind: 'INSTALLMENT',
      label: 'Structural frame',
      id: 'inst-3',
    });
    expect(byId.get('inv-c')).toEqual({ kind: 'IPC', label: 'IPA-006', id: 'ipc-6' });
    // A migration-loaded invoice says it has no source rather than borrowing one.
    expect(byId.get('inv-migrated')).toEqual({ kind: 'NONE', label: null, id: null });
  });

  /**
   * A receipt belongs to a client, not a project. Only the allocations against *this* contract's
   * invoices are this project's money — the receipt's own total may be larger.
   */
  it('reports only the part of a receipt allocated to this contract', async () => {
    const { service } = build({
      receipts: [
        {
          id: 'r-1',
          receiptDate: new Date('2026-09-01'),
          currencyCode: 'USD',
          totalAmount: new Decimal('200000'),
          allocatedAmount: new Decimal('180000'),
          unallocatedAmount: new Decimal('20000'),
          paymentMethod: 'Bank Transfer',
          reference: 'free text',
          bankReference: 'TRX784512',
          postingStatus: 'POSTED',
          clientAllocations: [
            {
              id: 'al-1',
              allocatedAmount: new Decimal('105000'),
              allocationDate: new Date('2026-09-01'),
              clientInvoiceId: 'inv-1',
              invoice: { id: 'inv-1', invoiceNumber: 'INV-0001', contractId: 'c-1' },
            },
            {
              id: 'al-2',
              allocatedAmount: new Decimal('75000'),
              allocationDate: new Date('2026-09-01'),
              clientInvoiceId: 'inv-other',
              invoice: { id: 'inv-other', invoiceNumber: 'INV-9999', contractId: 'c-other' },
            },
          ],
        },
      ],
      clientUnapplied: new Decimal('20000'),
    });

    const result = await service.getBilling(financeIdentity, 'p-1');

    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0]!.allocatedToThisContract).toBe('105000.00');
    expect(result.receipts[0]!.allocations).toHaveLength(1);
    // Unapplied cash is never hidden, and is reported as the client-level figure it is.
    expect(result.receipts[0]!.unallocatedAmount).toBe('20000.00');
    expect(result.clientUnappliedTotal).toBe('20000.00');
    // The bank's reference reconciles against a statement; free text is only the fallback.
    expect(result.receipts[0]!.reference).toBe('TRX784512');
  });

  /** Withheld, never zeroed — a figure the caller may not see must not read as "nothing owed". */
  it('withholds every money field without financial visibility', async () => {
    const { service } = build({ billingInvoices: [billingInvoice()] });
    const result = await service.getBilling(noFinanceIdentity, 'p-1');

    expect(result.position.invoiced).toBeNull();
    expect(result.position.collectionRate).toBeNull();
    expect(result.invoices[0]!.totalAmount).toBeNull();
    // Structural facts stay readable: what exists is not a commercial secret.
    expect(result.invoices[0]!.status).toBe('UNPAID');
    expect(result.position.postedInvoiceCount).toBe(1);
  });

  /** "Nothing invoiced" and "0% collected" are different statements; only one is true here. */
  it('returns a null collection rate when nothing has been invoiced', async () => {
    const { service } = build({ billingInvoices: [] });
    const result = await service.getBilling(financeIdentity, 'p-1');
    expect(result.position.collectionRate).toBeNull();
    expect(result.position.invoiced).toBe('0.00');
  });

  it('answers with no contract rather than an error when the project has none', async () => {
    const { service } = build({ contract: null });
    const result = await service.getBilling(financeIdentity, 'p-1');
    expect(result.contractId).toBeNull();
    expect(result.invoices).toEqual([]);
    expect(result.aging.every((b) => b.amount === null)).toBe(true);
  });
});

describe('capabilities — receipt permissions are the caller-s, not a hardcoded false', () => {
  it('grants receipt capabilities from the real permissions', async () => {
    const identity = identityWith([
      PERMISSIONS.contractsView,
      PERMISSIONS.financialPositionView,
      PERMISSIONS.receiptsCreate,
      PERMISSIONS.receiptsAllocate,
    ]);
    const { service } = build({});
    const result = await service.getSummary(identity, 'p-1');
    expect(result.capabilities.canRecordReceipt).toBe(true);
    expect(result.capabilities.canAllocateReceipt).toBe(true);
  });

  it('withholds them from a caller without the permission', async () => {
    const { service } = build({});
    const result = await service.getSummary(financeIdentity, 'p-1');
    expect(result.capabilities.canRecordReceipt).toBe(false);
    expect(result.capabilities.canAllocateReceipt).toBe(false);
  });
});

describe('securityPosition — retention held and advance recovered', () => {
  /** CONST-COM-005: both come from the deductions on effective certificates, categorised. */
  it('sums the RETENTION and ADVANCE_RECOVERY slices of the certificate deductions', async () => {
    const { service } = build({
      contract: {
        ...baseContract,
        advanceTerms: [
          {
            id: 'a-1',
            advanceType: 'MOBILIZATION',
            description: null,
            amount: new Decimal('240000'),
            percentage: null,
            recoveryRate: new Decimal('0.1'),
          },
        ],
      },
      certs: [
        {
          id: 'ipc-1',
          certifiedTotal: new Decimal('500000'),
          deductions: [
            { amount: new Decimal('25000'), deductionType: 'RETENTION' },
            { amount: new Decimal('50000'), deductionType: 'ADVANCE_RECOVERY' },
            { amount: new Decimal('1000'), deductionType: 'OTHER' },
          ],
        },
      ],
    });

    const result = await service.getSummary(financeIdentity, 'p-1');

    expect(result.securityPosition.applicable).toBe(true);
    expect(result.securityPosition.retentionHeld).toBe('25000.00');
    expect(result.securityPosition.advanceRecovered).toBe('50000.00');
    expect(result.securityPosition.advanceOutstanding).toBe('190000.00');
    // The same deduction set still drives certified net — the two can never disagree.
    expect(result.metrics.certifiedNet.amount).toBe('424000.00');
  });

  /**
   * ADR-023 CONST-COM-013/014 — a payment-schedule contract deducts neither. `applicable: false`
   * rather than three zeros: "we hold no retention" and "retention does not apply here" are
   * different statements, and only the second is true.
   */
  it('reports not-applicable rather than zero on a MILESTONE contract', async () => {
    const { service } = build({ contract: { ...baseContract, billingModel: 'MILESTONE' } });
    const result = await service.getSummary(financeIdentity, 'p-1');
    expect(result.securityPosition).toEqual({
      applicable: false,
      retentionHeld: null,
      advanceRecovered: null,
      advanceOutstanding: null,
    });
  });

  /** A percentage-only advance has no principal to count down from, so none is invented. */
  it('leaves advance outstanding null when no term carries an amount', async () => {
    const { service } = build({
      contract: {
        ...baseContract,
        advanceTerms: [
          {
            id: 'a-1',
            advanceType: 'MOBILIZATION',
            description: null,
            amount: null,
            percentage: new Decimal('0.2'),
            recoveryRate: new Decimal('0.1'),
          },
        ],
      },
    });
    const result = await service.getSummary(financeIdentity, 'p-1');
    expect(result.securityPosition.advanceRecovered).toBe('0.00');
    expect(result.securityPosition.advanceOutstanding).toBeNull();
  });
});
