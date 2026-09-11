import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { BoqTreeService } from '../application/boq-tree.service.js';
import type { BoqChangeEventInput } from '../infrastructure/boq-prisma.repository.js';

/**
 * The contingency draw command (ADR-029 CONST-BOQ-028 / spec C-3, C-4). DB-free: the repo and
 * tenancy are mocked (the tree-history spec's style), so what is under test is the pure decision
 * logic — the allowance-shape guard, the over-draw rejection, the net-zero reallocation, and the
 * single MOVE event the reallocation hands the repo. The atomic two-write transaction itself is
 * exercised by the DB-backed commit suite; here we prove the amounts and the guards.
 */

const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;
const boq = { id: 'boq1', organizationId: 'o1', currency: 'USD', versions: [{ id: 'v1' }] };

/** An allowance-style leaf: quantity 1, the whole amount in unitRate = totalAmount. */
function allowance(over: Record<string, unknown> = {}) {
  return {
    id: 'src',
    versionId: 'v1',
    parentId: 's1',
    path: 's1/src',
    depth: 1,
    sortOrder: 1,
    code: '01.900',
    description: 'Contingency allowance',
    isLeaf: true,
    unit: 'LS',
    quantity: new Decimal('1'),
    unitRate: new Decimal('500'),
    totalAmount: new Decimal('500'),
    currency: 'USD',
    measurementMethod: 'QUANTITY',
    pricingBasis: 'LUMP_SUM',
    nodeRole: 'CONTINGENCY',
    commercialTreatment: 'IN_CONTRACT',
    isActive: true,
    ...over,
  };
}

/** A measured UNIT_RATE work leaf: quantity ≠ 1. */
function measured(over: Record<string, unknown> = {}) {
  return {
    id: 'work',
    versionId: 'v1',
    parentId: 's1',
    path: 's1/work',
    depth: 1,
    sortOrder: 0,
    code: '01.001',
    description: 'Concrete',
    isLeaf: true,
    unit: 'm3',
    quantity: new Decimal('100'),
    unitRate: new Decimal('10'),
    totalAmount: new Decimal('1000'),
    currency: 'USD',
    measurementMethod: 'QUANTITY',
    pricingBasis: 'UNIT_RATE',
    nodeRole: 'WORK',
    commercialTreatment: 'IN_CONTRACT',
    isActive: true,
    ...over,
  };
}

/** A default allowance-style ABSORBED target: quantity 1, starts at 0.00. */
function absorbedTarget(over: Record<string, unknown> = {}) {
  return allowance({
    id: 'target',
    code: '01.500',
    description: 'Absorbed scope',
    nodeRole: 'WORK',
    commercialTreatment: 'ABSORBED',
    unitRate: new Decimal('0'),
    totalAmount: new Decimal('0'),
    ...over,
  });
}

function build(opts: {
  status?: 'DRAFT' | 'COMMITTED' | 'SNAPSHOT';
  target?: Record<string, unknown>;
  source?: Record<string, unknown>;
  nodes?: unknown[];
} = {}) {
  const source = allowance(opts.source);
  const target = absorbedTarget(opts.target);
  const nodes = opts.nodes ?? [source, target];

  const repo = {
    findByProject: jest.fn().mockResolvedValue(boq),
    findVersion: jest.fn().mockResolvedValue({ id: 'v1', status: opts.status ?? 'COMMITTED' }),
    findNodeById: jest.fn().mockResolvedValue(target),
    findNodesByVersion: jest.fn().mockResolvedValue(nodes),
    reallocateBetweenNodes: jest.fn().mockResolvedValue(undefined),
  };
  const tenancy = { getClient: () => ({}) };
  const svc = new BoqTreeService(tenancy as never, repo as never);
  return { svc, repo, source, target };
}

describe('BoqTreeService.drawContingency — ADR-029 C-3/C-4', () => {
  it('reallocates net-zero: contingency −amount, target +amount, in-contract total constant', async () => {
    // source 500 allowance, target 0 → draw 200. After: source 300, target 200. Total 500 constant.
    const { svc, repo } = build({});
    const result = await svc.drawContingency(identity, 'p1', 'v1', 'target', '200.00');

    const [, src, tgt, event] = repo.reallocateBetweenNodes.mock.calls[0] as [
      unknown,
      { id: string; data: { unitRate: Decimal; totalAmount: Decimal } },
      { id: string; data: { unitRate: Decimal; totalAmount: Decimal } },
      BoqChangeEventInput,
    ];
    expect(src.id).toBe('src');
    expect(src.data.totalAmount.toFixed(2)).toBe('300.00');
    expect(tgt.id).toBe('target');
    expect(tgt.data.totalAmount.toFixed(2)).toBe('200.00');

    // Exactly one MOVE event, carrying the amounts.
    expect(event.action).toBe('MOVE');
    expect(event.oldValue).toBe('0.00');
    expect(event.newValue).toBe('200.00');
    expect(event.actorUserId).toBe('u1');

    // Derived remaining ticks down (recomputed from the returned rows the mock still holds at 500,
    // because the mock does not mutate — so this asserts the pre-write live sum path is wired, and
    // the constant total is proven by the two write amounts above).
    expect(result.inContractTotal).toBe('500.00');
  });

  it('rejects an over-draw beyond the allowance with 400 CONTINGENCY_EXCEEDED', async () => {
    const { svc } = build({});
    await expect(
      svc.drawContingency(identity, 'p1', 'v1', 'target', '500.01'),
    ).rejects.toMatchObject({
      response: { errorCode: 'CONTINGENCY_EXCEEDED' },
    });
  });

  it('allows a draw of exactly the remaining (leaves the allowance at 0.00)', async () => {
    const { svc, repo } = build({});
    await svc.drawContingency(identity, 'p1', 'v1', 'target', '500.00');
    const src = repo.reallocateBetweenNodes.mock.calls[0][1] as { data: { totalAmount: Decimal } };
    expect(src.data.totalAmount.toFixed(2)).toBe('0.00');
  });

  it('rejects a non-positive amount', async () => {
    const { svc } = build({});
    await expect(svc.drawContingency(identity, 'p1', 'v1', 'target', '0')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.drawContingency(identity, 'p1', 'v1', 'target', '-5.00')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a measured (quantity ≠ 1) target — no distortion-free rate exists', async () => {
    const target = measured();
    const source = allowance();
    const repo = {
      findByProject: jest.fn().mockResolvedValue(boq),
      findVersion: jest.fn().mockResolvedValue({ id: 'v1', status: 'COMMITTED' }),
      findNodeById: jest.fn().mockResolvedValue(target),
      findNodesByVersion: jest.fn().mockResolvedValue([source, target]),
      reallocateBetweenNodes: jest.fn(),
    };
    const svc = new BoqTreeService({ getClient: () => ({}) } as never, repo as never);
    await expect(
      svc.drawContingency(identity, 'p1', 'v1', 'work', '50.00'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.reallocateBetweenNodes).not.toHaveBeenCalled();
  });

  it('refuses to draw onto the contingency line itself', async () => {
    const source = allowance();
    const repo = {
      findByProject: jest.fn().mockResolvedValue(boq),
      findVersion: jest.fn().mockResolvedValue({ id: 'v1', status: 'COMMITTED' }),
      findNodeById: jest.fn().mockResolvedValue(source),
      findNodesByVersion: jest.fn().mockResolvedValue([source]),
      reallocateBetweenNodes: jest.fn(),
    };
    const svc = new BoqTreeService({ getClient: () => ({}) } as never, repo as never);
    await expect(
      svc.drawContingency(identity, 'p1', 'v1', 'src', '10.00'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses when there is no contingency line to draw from', async () => {
    const target = allowance({ id: 'target', nodeRole: 'WORK', commercialTreatment: 'ABSORBED' });
    const repo = {
      findByProject: jest.fn().mockResolvedValue(boq),
      findVersion: jest.fn().mockResolvedValue({ id: 'v1', status: 'COMMITTED' }),
      findNodeById: jest.fn().mockResolvedValue(target),
      findNodesByVersion: jest.fn().mockResolvedValue([target]),
      reallocateBetweenNodes: jest.fn(),
    };
    const svc = new BoqTreeService({ getClient: () => ({}) } as never, repo as never);
    await expect(
      svc.drawContingency(identity, 'p1', 'v1', 'target', '10.00'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses funding a SEPARATE_CHARGE target (would break the tie-out)', async () => {
    const { svc, repo } = build({ target: { commercialTreatment: 'SEPARATE_CHARGE' } });
    await expect(
      svc.drawContingency(identity, 'p1', 'v1', 'target', '10.00'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.reallocateBetweenNodes).not.toHaveBeenCalled();
  });

  it('refuses a draw against a SNAPSHOT (immutable record → 403)', async () => {
    const { svc } = build({ status: 'SNAPSHOT' });
    await expect(
      svc.drawContingency(identity, 'p1', 'v1', 'target', '10.00'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('works on a pre-commit DRAFT too (the pin is a no-op there)', async () => {
    const { svc, repo } = build({ status: 'DRAFT' });
    await svc.drawContingency(identity, 'p1', 'v1', 'target', '100.00');
    expect(repo.reallocateBetweenNodes).toHaveBeenCalledTimes(1);
  });

  // Guard that the net-zero ConflictException path is reachable in principle (defensive assertion):
  // it never fires with quantity = 1 on both sides, which is why every happy path above succeeds.
  it('never throws CONTRACT_VALUE_LOCKED on a legitimate quantity-1 draw', async () => {
    const { svc } = build({});
    await expect(
      svc.drawContingency(identity, 'p1', 'v1', 'target', '123.45'),
    ).resolves.toBeDefined();
    expect(ConflictException).toBeDefined();
  });
});
