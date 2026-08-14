import { Decimal } from '@prisma/client/runtime/library';

import { ProjectFinancialPositionService } from './project-financial-position.service.js';

/**
 * ADR-013 — Project Financial Position. Forecast cost folds remaining committed cost into posted
 * actuals; forecast margin is contract value minus that forecast. Commitments never touch the
 * accounting P&L, but they are mandatory here — a posted-actuals-only margin overstates.
 */
const identity = { activeOrganizationId: 'o1' } as never;

function build(repo: Record<string, jest.Mock>) {
  const tenancy = { getClient: () => ({}) } as never;
  const svc = new ProjectFinancialPositionService(tenancy, repo as never);
  return svc;
}

describe('ProjectFinancialPositionService.getForProject', () => {
  it('combines revenue, actual cost and remaining commitments into forecast cost and margin', async () => {
    const svc = build({
      findMainContract: jest
        .fn()
        .mockResolvedValue({ id: 'c1', contractValue: new Decimal('1000000'), currency: 'USD' }),
      sumRemainingCommitments: jest.fn().mockResolvedValue(new Decimal('150000')),
      sumActualCost: jest.fn().mockResolvedValue(new Decimal('600000')),
      sumCertifiedRevenue: jest.fn().mockResolvedValue(new Decimal('700000')),
      sumSettlement: jest
        .fn()
        .mockResolvedValue({ invoiced: new Decimal('650000'), received: new Decimal('500000') }),
    });

    const res = await svc.getForProject(identity, 'p1');

    expect(res.hasContract).toBe(true);
    expect(res.currency).toBe('USD');
    expect(res.actualCost).toBe('600000.00');
    expect(res.remainingCommitments).toBe('150000.00');
    // 600k actual + 150k remaining
    expect(res.forecastCost).toBe('750000.00');
    // 1m contract − 750k forecast cost
    expect(res.forecastMargin).toBe('250000.00');
    // 650k invoiced − 500k received
    expect(res.outstandingReceivables).toBe('150000.00');
    expect(res.receivedRevenue).toBe('500000.00');
  });

  it('reports cost and forecast but no revenue or margin when the project has no main contract', async () => {
    const svc = build({
      findMainContract: jest.fn().mockResolvedValue(null),
      sumRemainingCommitments: jest.fn().mockResolvedValue(new Decimal('40000')),
      sumActualCost: jest.fn().mockResolvedValue(new Decimal('90000')),
      sumCertifiedRevenue: jest.fn(),
      sumSettlement: jest.fn(),
    });

    const res = await svc.getForProject(identity, 'p1');

    expect(res.hasContract).toBe(false);
    expect(res.contractValue).toBeNull();
    expect(res.forecastMargin).toBeNull();
    expect(res.actualCost).toBe('90000.00');
    expect(res.forecastCost).toBe('130000.00');
    // Revenue queries are not run without a contract.
    expect(res.certifiedRevenue).toBeNull();
  });
});
