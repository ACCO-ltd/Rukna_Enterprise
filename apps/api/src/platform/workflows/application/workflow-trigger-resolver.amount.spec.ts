import { Decimal } from '@prisma/client/runtime/library';

import { WorkflowTriggerResolverService } from './workflow-trigger-resolver.service.js';

/**
 * ADR-022 CONST-DOA-005 — the resolver routes a transition to the binding whose amount band
 * contains the document's value. Bands are half-open [min, max): min inclusive, max exclusive.
 * An unranged binding is a catch-all; a ranged binding needs an amount to be eligible at all.
 */
describe('WorkflowTriggerResolverService — amount-band routing', () => {
  function build(bindings: unknown[]) {
    const prisma = {
      // No requirement policy rows → getRequirement defaults to OPTIONAL (binding optional).
      workflowRequirementPolicy: { findMany: jest.fn().mockResolvedValue([]) },
      workflowTriggerBinding: { findMany: jest.fn().mockResolvedValue(bindings) },
    };
    const tenancy = { getClient: () => prisma } as never;
    return new WorkflowTriggerResolverService(tenancy);
  }

  const banded = (id: string, min: number | null, max: number | null) => ({
    id,
    organizationId: 'o1',
    triggerKind: 'STATE_TRANSITION',
    entityType: 'PurchaseOrder',
    transactionType: 'PURCHASE_ORDER',
    fromState: 'DRAFT',
    toState: 'SUBMITTED',
    workflowDefinitionId: `def-${id}`,
    priority: 10,
    minAmount: min === null ? null : new Decimal(min),
    maxAmount: max === null ? null : new Decimal(max),
    isActive: true,
    definition: { id: `def-${id}`, transactionType: 'PURCHASE_ORDER' },
  });

  const resolve = (svc: WorkflowTriggerResolverService, amount: number | null) =>
    svc.resolveForStateTransition(
      'o1',
      'PurchaseOrder',
      'DRAFT',
      'SUBMITTED',
      amount === null ? null : new Decimal(amount),
    );

  const bands = [banded('low', 0, 1000), banded('mid', 1000, 50000), banded('high', 50000, null)];

  it('routes a small value to the low band', async () => {
    const svc = build(bands);
    expect((await resolve(svc, 500))?.id).toBe('low');
  });

  it('routes a mid value to the mid band', async () => {
    const svc = build(bands);
    expect((await resolve(svc, 5000))?.id).toBe('mid');
  });

  it('routes a large value to the unbounded top band', async () => {
    const svc = build(bands);
    expect((await resolve(svc, 250000))?.id).toBe('high');
  });

  it('treats the band as half-open: the boundary belongs to the upper band', async () => {
    const svc = build(bands);
    // 1000 is excluded from [0,1000) and included in [1000,50000).
    expect((await resolve(svc, 1000))?.id).toBe('mid');
    expect((await resolve(svc, 50000))?.id).toBe('high');
  });

  it('a catch-all (unranged) binding matches any amount', async () => {
    const svc = build([banded('any', null, null)]);
    expect((await resolve(svc, 999999))?.id).toBe('any');
  });

  it('a ranged binding is not eligible when no amount is supplied', async () => {
    const svc = build([banded('low', 0, 1000)]);
    expect(await resolve(svc, null)).toBeNull();
  });

  it('an amount-less transition still resolves a catch-all binding (backward compatible)', async () => {
    const svc = build([banded('any', null, null)]);
    expect((await resolve(svc, null))?.id).toBe('any');
  });
});
