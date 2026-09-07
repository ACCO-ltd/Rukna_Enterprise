import { Decimal } from '@prisma/client/runtime/library';

import { ProjectFinancialPositionService } from './project-financial-position.service.js';

/**
 * ADR-013 — Project Financial Position: posted actual cost, the commitment-ledger stages
 * behind it, and the baselined budget they are measured against. No forecast: see
 * `financial-position.policy.ts` for why the old one could not be defended.
 */
const identity = { activeOrganizationId: 'o1' } as never;

function build(repo: Record<string, jest.Mock>) {
  const tenancy = { getClient: () => ({}) } as never;
  return new ProjectFinancialPositionService(tenancy, repo as never);
}

describe('ProjectFinancialPositionService.getForProject', () => {
  it('reports the cost stages separately and measures them against the baselined budget', async () => {
    const svc = build({
      findMainContract: jest
        .fn()
        .mockResolvedValue({ id: 'c1', contractValue: new Decimal('1000000'), currency: 'USD' }),
      sumCommitmentStages: jest.fn().mockResolvedValue({
        openCommitment: new Decimal('100000'),
        accruedCost: new Decimal('50000'),
      }),
      sumActualCost: jest.fn().mockResolvedValue(new Decimal('600000')),
      sumBaselinedBudget: jest
        .fn()
        .mockResolvedValue({ total: new Decimal('900000'), currency: 'USD' }),
      sumCertifiedRevenue: jest.fn().mockResolvedValue(new Decimal('700000')),
      sumSettlement: jest
        .fn()
        .mockResolvedValue({ invoiced: new Decimal('650000'), received: new Decimal('500000') }),
    });

    const res = await svc.getForProject(identity, 'p1');

    expect(res.hasContract).toBe(true);
    expect(res.hasBudget).toBe(true);
    expect(res.currency).toBe('USD');
    expect(res.actualCost).toBe('600000.00');
    // The two stages stay apart: one is cancellable, the other is goods already on site.
    expect(res.openCommitment).toBe('100000.00');
    expect(res.accruedCost).toBe('50000.00');
    expect(res.committedToDate).toBe('750000.00');
    // 900k budget − 750k committed to date
    expect(res.uncommittedBudget).toBe('150000.00');
    // 650k invoiced − 500k received
    expect(res.outstandingReceivables).toBe('150000.00');
    expect(res.receivedRevenue).toBe('500000.00');
  });

  it('reports cost without revenue when the project has no main contract', async () => {
    const svc = build({
      findMainContract: jest.fn().mockResolvedValue(null),
      sumCommitmentStages: jest.fn().mockResolvedValue({
        openCommitment: new Decimal('30000'),
        accruedCost: new Decimal('10000'),
      }),
      sumActualCost: jest.fn().mockResolvedValue(new Decimal('90000')),
      sumBaselinedBudget: jest
        .fn()
        .mockResolvedValue({ total: new Decimal('200000'), currency: 'USD' }),
      sumCertifiedRevenue: jest.fn(),
      sumSettlement: jest.fn(),
    });

    const res = await svc.getForProject(identity, 'p1');

    expect(res.hasContract).toBe(false);
    expect(res.contractValue).toBeNull();
    expect(res.actualCost).toBe('90000.00');
    expect(res.committedToDate).toBe('130000.00');
    expect(res.uncommittedBudget).toBe('70000.00');
    // Currency still resolves — from the budget, when there is no contract to take it from.
    expect(res.currency).toBe('USD');
    // Revenue queries are not run without a contract.
    expect(res.certifiedRevenue).toBeNull();
  });

  /**
   * The state a project is in before anyone sets a budget. Cost is real and must be shown;
   * every ratio against the budget must be absent rather than rendered as 0%.
   */
  it('returns no budget figures at all when none is baselined', async () => {
    const svc = build({
      findMainContract: jest
        .fn()
        .mockResolvedValue({ id: 'c1', contractValue: new Decimal('500000'), currency: 'USD' }),
      sumCommitmentStages: jest.fn().mockResolvedValue({
        openCommitment: new Decimal('20000'),
        accruedCost: new Decimal('0'),
      }),
      sumActualCost: jest.fn().mockResolvedValue(new Decimal('5000')),
      sumBaselinedBudget: jest.fn().mockResolvedValue(null),
      sumCertifiedRevenue: jest.fn().mockResolvedValue(new Decimal('0')),
      sumSettlement: jest
        .fn()
        .mockResolvedValue({ invoiced: new Decimal('0'), received: new Decimal('0') }),
    });

    const res = await svc.getForProject(identity, 'p1');

    expect(res.hasBudget).toBe(false);
    expect(res.budgetTotal).toBeNull();
    expect(res.uncommittedBudget).toBeNull();
    expect(res.committedToDate).toBe('25000.00');
  });

  it('no longer exposes a forecast', async () => {
    const svc = build({
      findMainContract: jest.fn().mockResolvedValue(null),
      sumCommitmentStages: jest
        .fn()
        .mockResolvedValue({ openCommitment: new Decimal('0'), accruedCost: new Decimal('0') }),
      sumActualCost: jest.fn().mockResolvedValue(new Decimal('0')),
      sumBaselinedBudget: jest.fn().mockResolvedValue(null),
      sumCertifiedRevenue: jest.fn(),
      sumSettlement: jest.fn(),
    });

    const res = await svc.getForProject(identity, 'p1');

    expect(res).not.toHaveProperty('forecastCost');
    expect(res).not.toHaveProperty('forecastMargin');
    expect(res).not.toHaveProperty('remainingCommitments');
  });
});
