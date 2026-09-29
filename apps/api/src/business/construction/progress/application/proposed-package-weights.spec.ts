import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ProgressService } from './progress.service.js';
import { BoqController } from '../../boq/presentation/boq.controller.js';
import { buildTree } from '../../boq/application/boq-tree.service.js';

/**
 * The Delivery Plan's weights for a proposed grouping (owner decision 2026-09-29): package-level
 * ratios only: value-weighted for a cost-tier caller, an even split for anyone else (a one-leaf
 * package would otherwise reveal that leaf's share) — and no per-leaf share on the tree for anyone.
 */
const who = (...permissions: string[]): RequestIdentity => ({
  userId: 'u1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions,
});
const pmLike = who(PERMISSIONS.projectsManage, PERMISSIONS.boqView, PERMISSIONS.boqEditScope);
const costTier = who(PERMISSIONS.projectsManage, PERMISSIONS.boqView, PERMISSIONS.boqViewCost);

const leaf = (id: string, totalAmount: string | null, over: Record<string, unknown> = {}) => ({
  id,
  isLeaf: true,
  nodeRole: 'WORK',
  totalAmount: totalAmount === null ? null : new Decimal(totalAmount),
  unit: totalAmount === null ? null : 'm²',
  quantity: totalAmount === null ? null : new Decimal('1'),
  unitRate: totalAmount === null ? null : new Decimal(totalAmount),
  ...over,
});

function service(leaves: unknown[]) {
  const repo = { findLeavesForWeighting: jest.fn(async () => leaves) };
  const svc = new ProgressService(
    { getClient: () => ({}) } as never,
    repo as never,
    { assertMember: jest.fn(async () => undefined) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, repo };
}

describe('ProgressService.weighProposedPackages', () => {
  const leaves = [
    leaf('a', '600'),
    leaf('b', '300'),
    leaf('c', '100'),
    leaf('u', null),
    leaf('cont', '5000', { nodeRole: 'CONTINGENCY' }),
  ];
  const grouping = [
    { key: 'sec-1', boqNodeIds: ['a', 'u'] },
    { key: 'sec-2', boqNodeIds: ['b', 'c', 'cont'] },
  ];

  it('value-weights for a cost-tier caller, contingency excluded, plus unpriced leaves', async () => {
    const { svc } = service(leaves);
    const result = await svc.weighProposedPackages(costTier, 'p', grouping);
    expect(result.valueWeighted).toBe(true);
    expect(result.weights).toEqual([
      { key: 'sec-1', weight: 0.6 },
      { key: 'sec-2', weight: 0.4 },
    ]);
    expect(result.unpricedLeafIds).toEqual(['u']);
    // Package ratios only: no amount, no per-leaf share anywhere in the response.
    expect(JSON.stringify(result)).not.toMatch(/600|300|100|valueShare|amount/i);
  });

  it('gives a PM-like caller an even split, valueWeighted false, and still the unpriced leaves', async () => {
    const { svc } = service(leaves);
    const result = await svc.weighProposedPackages(pmLike, 'p', grouping);
    expect(result).toEqual({
      projectId: 'p',
      weights: [
        { key: 'sec-1', weight: 0.5 },
        { key: 'sec-2', weight: 0.5 },
      ],
      valueWeighted: false,
      unpricedLeafIds: ['u'],
    });
  });

  it.each([3, 6, 7])('splits %i packages evenly to exactly 1.0000 for a PM-like caller', async (n) => {
    const many = Array.from({ length: n }, (_, i) => leaf(`w${i}`, String(100 * (i + 1))));
    const { svc } = service(many);
    const result = await svc.weighProposedPackages(
      pmLike,
      'p',
      many.map((l, i) => ({ key: `k${i}`, boqNodeIds: [l.id] })),
    );
    const units = result.weights.reduce((sum, w) => sum + Math.round(w.weight * 10_000), 0);
    expect(units).toBe(10_000);
    expect(result.weights.every((w) => Number(w.weight.toFixed(4)) === w.weight)).toBe(true);
  });

  it('rounds value weights to exactly 1.0000 for a cost-tier caller', async () => {
    const thirds = [leaf('x', '100'), leaf('y', '100'), leaf('z', '100')];
    const { svc } = service(thirds);
    const result = await svc.weighProposedPackages(
      costTier,
      'p',
      thirds.map((l) => ({ key: l.id, boqNodeIds: [l.id] })),
    );
    expect(result.weights.map((w) => w.weight)).toEqual([0.3334, 0.3333, 0.3333]);
  });

  it('defeats the single-leaf probe: a one-leaf package gets the same even share', async () => {
    const { svc } = service(leaves);
    const probe = await svc.weighProposedPackages(pmLike, 'p', [
      { key: 'probe', boqNodeIds: ['b'] },
      { key: 'rest', boqNodeIds: ['a', 'c', 'u'] },
      { key: 'reserve', boqNodeIds: ['cont'] },
    ]);
    expect(probe.weights).toEqual([
      { key: 'probe', weight: 0.5 },
      { key: 'rest', weight: 0.5 },
      { key: 'reserve', weight: 0 }, // contingency only: not measurable scope
    ]);
    const regrouped = await svc.weighProposedPackages(pmLike, 'p', [
      { key: 'probe', boqNodeIds: ['a'] },
      { key: 'rest', boqNodeIds: ['b', 'c', 'u'] },
    ]);
    expect(regrouped.weights.map((w) => w.weight)).toEqual([0.5, 0.5]);
  });

  it('re-weighs a regrouping by value for a cost-tier caller', async () => {
    const { svc } = service(leaves);
    const result = await svc.weighProposedPackages(costTier, 'p', [
      { key: 'sec-1', boqNodeIds: ['a', 'b'] },
      { key: 'sec-2', boqNodeIds: ['c'] },
    ]);
    expect(result.weights.map((w) => w.weight)).toEqual([0.9, 0.1]);
  });

  it('splits equally when nothing is priced, so the weights still sum to 1', async () => {
    const { svc } = service([leaf('u1', null), leaf('u2', null)]);
    const result = await svc.weighProposedPackages(costTier, 'p', [
      { key: 'x', boqNodeIds: ['u1'] },
      { key: 'y', boqNodeIds: ['u2'] },
    ]);
    expect(result.weights).toEqual([
      { key: 'x', weight: 0.5 },
      { key: 'y', weight: 0.5 },
    ]);
  });
});

describe('the BOQ tree carries no per-leaf share of value', () => {
  it('sends a PM-like caller priced flags but no amounts and no shares', async () => {
    const row = {
      id: 'a', boqId: 'b', versionId: 'v', parentId: null, path: '', depth: 0, sortOrder: 0, code: '1.1',
      description: 'x', isLeaf: true, measurementMethod: 'QUANTITY', pricingBasis: 'UNIT_RATE', unit: 'm²',
      quantity: new Decimal('2'), unitRate: new Decimal('50'), currency: 'USD', totalAmount: new Decimal('100'),
      originNodeId: null, sourceType: 'BASELINE', sourceChangeOrderId: null, nodeRole: 'WORK',
      commercialTreatment: 'IN_CONTRACT', isActive: true, createdAt: new Date(0), updatedAt: new Date(0),
    };
    const tree = buildTree([row] as never, 'USD');
    const controller = new BoqController({} as never, { getTree: jest.fn(async () => tree) } as never, {} as never, {} as never);
    const nodes = await controller.getTree(pmLike, 'p', 'v');
    expect(nodes[0]).toMatchObject({ priced: true, unitRate: null, totalAmount: null, computedTotal: null });
    expect(JSON.stringify(nodes)).not.toMatch(/valueShare|100|50\.00/);
  });
});
