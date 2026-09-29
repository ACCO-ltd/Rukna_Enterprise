import { ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type BoqChangeEventResponse, type BoqCompareResponse, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BoqTreeService, buildTree } from '../application/boq-tree.service.js';
import {
  assertMayChangeBoqMoney,
  redactCompareMoney,
  redactHistoryMoney,
  redactNodeMoney,
  redactTreeMoney,
} from '../domain/boq-money-redaction.js';
import { BoqController } from '../presentation/boq.controller.js';

/**
 * ADR-029 §8 A-1/A-2 — BOQ money on the raw reads and writes (DB-free).
 *
 * Reads: a caller without the cost tier (a PM / Site Engineer: `view:boq`, maybe `edit-scope:boq`)
 * gets the tree, node write responses, change log, peer compare and readiness with every rate and
 * amount nulled — the same tier rule the workspace read model applies.
 * Writes: a scope-only editor cannot change a rate, the pricing basis or a lump sum's amount.
 */

const who = (...permissions: string[]): RequestIdentity => ({
  userId: 'u1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions,
});

const scopeOnly = who(PERMISSIONS.boqView, PERMISSIONS.boqEditScope);
const costEditor = who(PERMISSIONS.boqView, PERMISSIONS.boqEditCost, PERMISSIONS.boqViewCost);
const manager = who(PERMISSIONS.boqView, PERMISSIONS.boqManage);

const leaf = {
  id: 'n-2',
  code: '1.1',
  isLeaf: true,
  unit: 'm²',
  quantity: '180.000',
  unitRate: '1.25',
  totalAmount: '225.00',
  computedTotal: '225.00',
  children: [],
};
const section = { id: 'n-1', code: '1', isLeaf: false, unitRate: null, totalAmount: null, computedTotal: '225.00', children: [leaf] };

describe('BOQ money redaction (pure)', () => {
  it('nulls rate and amounts through the whole tree, keeping the structure', () => {
    const [root] = redactTreeMoney([section]);
    expect(root).toMatchObject({ code: '1', computedTotal: null, totalAmount: null });
    expect(root!.children[0]).toMatchObject({
      code: '1.1',
      unit: 'm²',
      quantity: '180.000',
      unitRate: null,
      totalAmount: null,
      computedTotal: null,
    });
  });

  it('nulls a stored node row (no computedTotal)', () => {
    const row = redactNodeMoney({ id: 'n', unitRate: new Decimal('5'), totalAmount: '5.00', quantity: new Decimal('1') });
    expect(row).toEqual({ id: 'n', unitRate: null, totalAmount: null, quantity: new Decimal('1') });
  });

  it('withholds money values in the change log, keeping who changed which line', () => {
    const base = { id: 'e', versionId: 'v', nodeId: 'n', code: '1.1', action: 'UPDATE', actorUserId: 'u', actorName: 'A', createdAt: 'x' };
    const events = [
      { ...base, field: 'unitRate', oldValue: '1.00', newValue: '1.25', detail: null },
      { ...base, field: 'totalAmount', oldValue: '0', newValue: '500.00', detail: 'Drew 500.00 from contingency 9.1 to 1.1' },
      { ...base, field: 'quantity', oldValue: '1', newValue: '2', detail: null },
    ] as unknown as BoqChangeEventResponse[];
    const [rate, drew, quantity] = redactHistoryMoney(events);
    expect(rate).toMatchObject({ field: 'unitRate', code: '1.1', oldValue: null, newValue: null });
    expect(drew).toMatchObject({ oldValue: null, newValue: null, detail: null });
    expect(quantity).toMatchObject({ oldValue: '1', newValue: '2' });
  });

  it('withholds totals and line money on the peer compare', () => {
    const response = {
      leftTotal: '10',
      rightTotal: '20',
      netDelta: '10',
      changes: [{ code: '1.1', oldQuantity: '1', newQuantity: '2', oldUnitRate: '5', newUnitRate: '5', oldAmount: '5', newAmount: '10', amountDelta: '5', amountDeltaPercent: '100' }],
    } as unknown as BoqCompareResponse;
    const redacted = redactCompareMoney(response);
    expect(redacted).toMatchObject({ leftTotal: null, rightTotal: null, netDelta: null });
    expect(redacted.changes[0]).toMatchObject({ newQuantity: '2', newUnitRate: null, newAmount: null, amountDelta: null });
  });
});

describe('BOQ money on the controller reads', () => {
  const marginReader = who(PERMISSIONS.boqView, PERMISSIONS.boqViewMargin);
  const compareResponse = {
    leftTotal: '10.00',
    rightTotal: '20.00',
    netDelta: '10.00',
    changes: [{ code: '1.1', newQuantity: '2', oldUnitRate: '5', newUnitRate: '5', oldAmount: '5', newAmount: '10', amountDelta: '5', amountDeltaPercent: '100' }],
  };

  function controller() {
    const treeService = {
      getTree: jest.fn(async () => [section]),
      moveNode: jest.fn(async () => [section]),
      addNode: jest.fn(async () => ({ ...leaf, children: undefined })),
      updateNode: jest.fn(async () => ({ ...leaf, children: undefined })),
    };
    const versioningService = {
      getReadiness: jest.fn(async () => ({ ready: false, itemCount: 1, totalAmount: '225.00' })),
      getContingencyRemaining: jest.fn(async () => '5000.00'),
    };
    const workspaceService = { compare: jest.fn(async () => compareResponse) };
    return new BoqController(versioningService as never, treeService as never, workspaceService as never, {} as never);
  }

  it('sends the tree without rates or amounts to a money-blind editor', async () => {
    const nodes = await controller().getTree(scopeOnly, 'p', 'v');
    expect(JSON.stringify(nodes)).not.toMatch(/1\.25|225\.00/);
    expect(nodes[0]!.children[0]).toMatchObject({ quantity: '180.000', unitRate: null });
  });

  it('sends the tree with money to a cost-tier reader', async () => {
    const nodes = await controller().getTree(costEditor, 'p', 'v');
    expect(nodes[0]!.children[0]).toMatchObject({ unitRate: '1.25', totalAmount: '225.00' });
  });

  it('withholds money from the node a money-blind editor just added, saved or moved', async () => {
    const c = controller();
    expect(await c.addNode(scopeOnly, 'p', 'v', { description: 'x' })).toMatchObject({ unitRate: null, totalAmount: null });
    expect(await c.updateNode(scopeOnly, 'p', 'v', 'n-2', { description: 'x' })).toMatchObject({ unitRate: null, totalAmount: null });
    const moved = await c.moveNode(scopeOnly, 'p', 'v', 'n-2', { newSortOrder: 0 } as never);
    expect(JSON.stringify(moved)).not.toMatch(/1\.25|225\.00/);
    expect(await c.addNode(costEditor, 'p', 'v', { description: 'x' })).toMatchObject({ unitRate: '1.25' });
  });

  it('withholds money on the peer compare and on readiness', async () => {
    const c = controller();
    const compare = await c.compare(scopeOnly, 'p', 'l', 'r');
    expect(compare).toMatchObject({ leftTotal: null, rightTotal: null, netDelta: null });
    expect(compare.changes[0]).toMatchObject({ newQuantity: '2', newUnitRate: null, amountDelta: null });
    expect(await c.readiness(scopeOnly, 'p', 'v')).toMatchObject({ itemCount: 1, totalAmount: null });
    expect(await c.readiness(costEditor, 'p', 'v')).toMatchObject({ totalAmount: '225.00' });
    expect((await c.compare(costEditor, 'p', 'l', 'r')).leftTotal).toBe('10.00');
  });

  it('gates contingency on the margin tier, with one shape for every caller', async () => {
    const c = controller();
    // The cost tier is not enough: contingency is a margin figure.
    expect(await c.contingency(costEditor, 'p', 'v')).toEqual({ versionId: 'v', contingencyRemaining: null, canViewMargin: false });
    expect(await c.contingency(scopeOnly, 'p', 'v')).toEqual({ versionId: 'v', contingencyRemaining: null, canViewMargin: false });
    expect(await c.contingency(marginReader, 'p', 'v')).toEqual({
      versionId: 'v',
      contingencyRemaining: '5000.00',
      canViewMargin: true,
    });
  });
});

describe('ADR-029 §8 A-1 — scope-only editors cannot change money', () => {
  const stored = { unitRate: new Decimal('100.00'), pricingBasis: 'UNIT_RATE', quantity: new Decimal('5.000') };
  const lumpStored = { unitRate: new Decimal('500.00'), pricingBasis: 'LUMP_SUM', quantity: new Decimal('5.000') };

  it('refuses a rate change, a basis change and a lump-sum amount change', () => {
    expect(() => assertMayChangeBoqMoney(scopeOnly, { unitRate: '120' }, stored)).toThrow(ForbiddenException);
    expect(() => assertMayChangeBoqMoney(scopeOnly, { pricingBasis: 'LUMP_SUM' }, stored)).toThrow(ForbiddenException);
    expect(() => assertMayChangeBoqMoney(scopeOnly, { quantity: '1' }, lumpStored)).toThrow(ForbiddenException);
  });

  it('allows absent fields, an unchanged echo, and a measured quantity', () => {
    expect(() => assertMayChangeBoqMoney(scopeOnly, {}, stored)).not.toThrow();
    expect(() =>
      assertMayChangeBoqMoney(scopeOnly, { unitRate: '100', pricingBasis: 'UNIT_RATE', quantity: '5' }, stored),
    ).not.toThrow();
    expect(() => assertMayChangeBoqMoney(scopeOnly, { quantity: '7.5' }, stored)).not.toThrow();
    expect(() => assertMayChangeBoqMoney(scopeOnly, { unitRate: '500.00', quantity: '5.000' }, lumpStored)).not.toThrow();
  });

  it('refuses a priced or lump-sum create, allows an unpriced one', () => {
    expect(() => assertMayChangeBoqMoney(scopeOnly, { unitRate: '10' }, null)).toThrow(ForbiddenException);
    expect(() => assertMayChangeBoqMoney(scopeOnly, { pricingBasis: 'LUMP_SUM' }, null)).toThrow(ForbiddenException);
    expect(() => assertMayChangeBoqMoney(scopeOnly, { pricingBasis: 'UNIT_RATE', quantity: '3' }, null)).not.toThrow();
  });

  it('lets a cost editor or a manager change money', () => {
    expect(() => assertMayChangeBoqMoney(costEditor, { unitRate: '120', pricingBasis: 'LUMP_SUM' }, stored)).not.toThrow();
    expect(() => assertMayChangeBoqMoney(manager, { unitRate: '120' }, stored)).not.toThrow();
  });

  it('is enforced by updateNode before anything is written', async () => {
    const node = {
      id: 'n-1',
      versionId: 'v',
      isLeaf: true,
      code: '1.1',
      description: 'Concrete',
      unit: 'm³',
      quantity: new Decimal('5.000'),
      unitRate: new Decimal('100.00'),
      totalAmount: '500.00',
      depth: 1,
      commercialTreatment: 'IN_CONTRACT',
      nodeRole: 'WORK',
      measurementMethod: 'QUANTITY',
      pricingBasis: 'UNIT_RATE',
    };
    const repo = {
      findByProject: jest.fn(async () => ({ id: 'b', organizationId: 'org-1', currency: 'USD', versions: [{ id: 'v', status: 'DRAFT' }] })),
      findVersion: jest.fn(async () => ({ id: 'v', status: 'DRAFT' })),
      findNodeById: jest.fn(async () => node),
      countChildren: jest.fn(async () => 0),
      findCodesInVersion: jest.fn(async () => new Set<string>()),
      updateNode: jest.fn(async (_p: unknown, _id: string, data: unknown) => ({ ...node, ...(data as object) })),
    };
    const service = new BoqTreeService({ getClient: () => ({}) } as unknown as TenancyService, repo as never);

    await expect(service.updateNode(scopeOnly, 'p', 'v', 'n-1', { unitRate: '120.00' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.updateNode).not.toHaveBeenCalled();

    await service.updateNode(scopeOnly, 'p', 'v', 'n-1', { description: 'Concrete, grade 30', unitRate: '100.00' });
    expect(repo.updateNode).toHaveBeenCalledTimes(1);
  });

  it('refuses to flip a priced item into a section, but not an unpriced one', () => {
    const pricedItem = { isLeaf: true, totalAmount: '500.00', ...stored };
    expect(() => assertMayChangeBoqMoney(scopeOnly, { isLeaf: false }, pricedItem)).toThrow(ForbiddenException);
    const unpricedItem = { isLeaf: true, totalAmount: null, unitRate: null, pricingBasis: 'UNIT_RATE', quantity: null };
    expect(() => assertMayChangeBoqMoney(scopeOnly, { isLeaf: false }, unpricedItem)).not.toThrow();
    // Unchanged echo of isLeaf is not a change.
    expect(() => assertMayChangeBoqMoney(scopeOnly, { isLeaf: true }, pricedItem)).not.toThrow();
    expect(() => assertMayChangeBoqMoney(manager, { isLeaf: false }, pricedItem)).not.toThrow();
  });

  it('is enforced by addNode before anything is written', async () => {
    const repo = {
      findByProject: jest.fn(async () => ({ id: 'b', organizationId: 'org-1', currency: 'USD', versions: [{ id: 'v', status: 'DRAFT' }] })),
      findVersion: jest.fn(async () => ({ id: 'v', status: 'DRAFT' })),
      createNodeAtPosition: jest.fn(),
    };
    const service = new BoqTreeService({ getClient: () => ({}) } as unknown as TenancyService, repo as never);
    await expect(
      service.addNode(scopeOnly, 'p', 'v', { description: 'Tiling', isLeaf: true, quantity: '3', unitRate: '9.00' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.addNode(scopeOnly, 'p', 'v', { description: 'Prelims', isLeaf: true, pricingBasis: 'LUMP_SUM' as never }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.createNodeAtPosition).not.toHaveBeenCalled();
  });

  it('refuses the isLeaf flip through updateNode', async () => {
    const node = {
      id: 'n-1', versionId: 'v', isLeaf: true, code: '1.1', description: 'Concrete', unit: 'm³',
      quantity: new Decimal('5.000'), unitRate: new Decimal('100.00'), totalAmount: '500.00', depth: 1,
      commercialTreatment: 'IN_CONTRACT', nodeRole: 'WORK', measurementMethod: 'QUANTITY', pricingBasis: 'UNIT_RATE',
    };
    const repo = {
      findByProject: jest.fn(async () => ({ id: 'b', organizationId: 'org-1', currency: 'USD', versions: [{ id: 'v', status: 'DRAFT' }] })),
      findVersion: jest.fn(async () => ({ id: 'v', status: 'DRAFT' })),
      findNodeById: jest.fn(async () => node),
      countChildren: jest.fn(async () => 0),
      updateNode: jest.fn(),
    };
    const service = new BoqTreeService({ getClient: () => ({}) } as unknown as TenancyService, repo as never);
    await expect(service.updateNode(scopeOnly, 'p', 'v', 'n-1', { isLeaf: false })).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.updateNode).not.toHaveBeenCalled();
  });
});

describe('priced and valueShare on the tree — visible to every tier', () => {
  const row = (over: Record<string, unknown>) => ({
    boqId: 'b', versionId: 'v', path: '', depth: 0, sortOrder: 0, description: 'x', measurementMethod: 'QUANTITY',
    pricingBasis: 'UNIT_RATE', unit: null, quantity: null, unitRate: null, currency: 'USD', totalAmount: null,
    originNodeId: null, sourceType: 'BASELINE', sourceChangeOrderId: null, nodeRole: 'WORK',
    commercialTreatment: 'IN_CONTRACT', isActive: true, createdAt: new Date(0), updatedAt: new Date(0), parentId: null,
    ...over,
  });
  const nodes = [
    row({ id: 's1', code: '1', isLeaf: false }),
    row({ id: 'a', code: '1.1', isLeaf: true, parentId: 's1', unit: 'm²', quantity: new Decimal('10'), unitRate: new Decimal('30'), totalAmount: new Decimal('300') }),
    row({ id: 'b', code: '1.2', isLeaf: true, parentId: 's1', sortOrder: 1, unit: 'LS', quantity: new Decimal('1'), unitRate: new Decimal('100'), totalAmount: new Decimal('100') }),
    row({ id: 'c', code: '1.3', isLeaf: true, parentId: 's1', sortOrder: 2, unit: 'nr' }),
  ];

  it('marks priced leaves and gives each node its share of the version value', () => {
    const [section] = buildTree(nodes as never, 'USD');
    const [a, b, c] = section!.children;
    expect([a!.priced, b!.priced, c!.priced, section!.priced]).toEqual([true, true, false, false]);
    expect([a!.valueShare, b!.valueShare, c!.valueShare, section!.valueShare]).toEqual([0.75, 0.25, null, 1]);
  });

  it('keeps both through the money-blind redaction', () => {
    const [section] = redactTreeMoney(buildTree(nodes as never, 'USD'));
    expect(section!.children[0]).toMatchObject({ unitRate: null, totalAmount: null, priced: true, valueShare: 0.75 });
  });
});
