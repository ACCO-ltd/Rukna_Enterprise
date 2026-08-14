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

const financeIdentity = identityWith([PERMISSIONS.contractsView, PERMISSIONS.financialPositionView]);
const noFinanceIdentity = identityWith([PERMISSIONS.contractsView]);

const baseContract = {
  id: 'c-1',
  contractNumber: 'CN-1',
  status: 'ACTIVE',
  currency: 'USD',
  contractValue: new Decimal('1000000'),
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
}) {
  const repo = {
    findMainContract: jest
      .fn()
      .mockResolvedValue('contract' in overrides ? overrides.contract : baseContract),
    findEffectiveCertificates: overrides.certRejects
      ? jest.fn().mockRejectedValue(new Error('db down'))
      : jest.fn().mockResolvedValue(overrides.certs ?? []),
    findInvoices: jest.fn().mockResolvedValue(overrides.invoices ?? []),
    findApplicationsWithCertificates: jest.fn().mockResolvedValue(overrides.applications ?? []),
    findRecentActivity: jest.fn().mockResolvedValue([]),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const tenancy = { getClient: () => ({}) };
  const service = new CommercialService(tenancy as never, projectAccess as never, repo as never);
  return { repo, service };
}

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
          currencyCode: 'USD',
          allocations: [{ allocatedAmount: new Decimal('200000') }],
        },
      ],
    });
    const res = await service.getSummary(financeIdentity, 'p-1');

    expect(res.metrics.contractValue).toMatchObject({ state: 'OK', amount: '1000000.00', currency: 'USD' });
    expect(res.metrics.certifiedGross).toMatchObject({ state: 'OK', amount: '500000.00', sourceCount: 1 });
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
