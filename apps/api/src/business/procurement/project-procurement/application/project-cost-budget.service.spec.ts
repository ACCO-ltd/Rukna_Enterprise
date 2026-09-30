import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { ProjectCostBudgetService } from './project-cost-budget.service.js';

/**
 * GET /projects/:projectId/procurement/budgets/:budgetId — a version with its lines, so a Working
 * version can be edited without writing over lines the editor never saw.
 */
const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;

function budgetRow(over: Record<string, unknown> = {}) {
  return {
    id: 'b3',
    projectId: 'p1',
    versionNumber: 3,
    status: 'DRAFT',
    currency: 'USD',
    notes: null,
    derivedFromId: 'b2',
    preparedBy: 'u1',
    baselinedAt: null,
    baselinedBy: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    lines: [
      {
        id: 'l1',
        boqNodeId: 'n1',
        spendCategoryId: null,
        description: 'Excavation',
        budgetAmount: new Decimal('1000.5'),
        sortOrder: 0,
        boqNode: { code: '1.1' },
        spendCategory: null,
      },
      {
        id: 'l2',
        boqNodeId: null,
        spendCategoryId: 'c1',
        description: 'Site labour',
        budgetAmount: new Decimal('2000'),
        sortOrder: 1,
        boqNode: null,
        spendCategory: { name: 'Labour' },
      },
    ],
    ...over,
  };
}

function build(opts: { budget?: unknown; member?: boolean } = {}) {
  const budget = 'budget' in opts ? opts.budget : budgetRow();
  const prisma = {};
  const tenancy = { getClient: () => prisma } as never;
  const projectAccess = {
    assertMember: jest.fn(async () => {
      if (opts.member === false) throw new ForbiddenException('not a member');
    }),
  };
  const repo = { findBudgetById: jest.fn().mockResolvedValue(budget) };
  const svc = new ProjectCostBudgetService(
    tenancy,
    projectAccess as never,
    repo as never,
    {} as never,
  );
  return { svc, repo, projectAccess, prisma };
}

describe('ProjectCostBudgetService.findForProject', () => {
  it('returns the version with its lines, totals and money as decimal strings', async () => {
    const { svc, repo } = build();

    const result = await svc.findForProject(identity, 'p1', 'b3');

    expect(repo.findBudgetById).toHaveBeenCalledWith(expect.anything(), 'o1', 'b3');
    expect(result.status).toBe('DRAFT');
    expect(result.total).toBe('3000.50');
    expect(result.lines).toEqual([
      expect.objectContaining({ id: 'l1', boqNodeId: 'n1', boqNodeCode: '1.1', budgetAmount: '1000.50' }),
      expect.objectContaining({ id: 'l2', spendCategoryId: 'c1', spendCategoryName: 'Labour', budgetAmount: '2000.00' }),
    ]);
  });

  it('requires project membership, like the list', async () => {
    const { svc, projectAccess, repo } = build({ member: false });

    await expect(svc.findForProject(identity, 'p1', 'b3')).rejects.toBeInstanceOf(ForbiddenException);
    expect(projectAccess.assertMember).toHaveBeenCalledWith(identity, 'p1');
    expect(repo.findBudgetById).not.toHaveBeenCalled();
  });

  it('404s for a version that does not exist in the organisation', async () => {
    const { svc } = build({ budget: null });
    await expect(svc.findForProject(identity, 'p1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s for a version that belongs to another project', async () => {
    const { svc } = build({ budget: budgetRow({ projectId: 'p2' }) });
    await expect(svc.findForProject(identity, 'p1', 'b3')).rejects.toBeInstanceOf(NotFoundException);
  });
});
