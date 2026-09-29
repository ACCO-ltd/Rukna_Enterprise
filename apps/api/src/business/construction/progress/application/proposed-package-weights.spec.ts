import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ProgressService } from './progress.service.js';
import { BoqController } from '../../boq/presentation/boq.controller.js';
import { buildTree } from '../../boq/application/boq-tree.service.js';

/**
 * The Delivery Plan's weights for a proposed grouping (owner decision 2026-09-29): package-level
 * ratios only, value-weighted on the server, identical for a money-blind PM and a cost-tier reader —
 * and no per-leaf share of the BOQ value on the tree for anyone.
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

  it('returns package weights summing to 1, contingency excluded, plus unpriced leaves', async () => {
    const { svc } = service(leaves);
    const result = await svc.weighProposedPackages(pmLike, 'p', grouping);
    expect(result.weights).toEqual([
      { key: 'sec-1', weight: 0.6 },
      { key: 'sec-2', weight: 0.4 },
    ]);
    expect(result.unpricedLeafIds).toEqual(['u']);
    // Package ratios only: no amount, no per-leaf share anywhere in the response.
    expect(JSON.stringify(result)).not.toMatch(/600|300|100|valueShare|amount/i);
  });

  it('gives a PM-like caller exactly what a cost-tier caller gets', async () => {
    const pm = await service(leaves).svc.weighProposedPackages(pmLike, 'p', grouping);
    const cost = await service(leaves).svc.weighProposedPackages(costTier, 'p', grouping);
    expect(pm).toEqual(cost);
  });

  it('re-weighs a regrouping (a leaf moved between packages)', async () => {
    const { svc } = service(leaves);
    const result = await svc.weighProposedPackages(pmLike, 'p', [
      { key: 'sec-1', boqNodeIds: ['a', 'b'] },
      { key: 'sec-2', boqNodeIds: ['c'] },
    ]);
    expect(result.weights.map((w) => w.weight)).toEqual([0.9, 0.1]);
  });

  it('splits equally when nothing is priced, so the weights still sum to 1', async () => {
    const { svc } = service([leaf('u1', null), leaf('u2', null)]);
    const result = await svc.weighProposedPackages(pmLike, 'p', [
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
