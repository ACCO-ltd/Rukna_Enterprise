import { ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type BoqChangeEventResponse, type BoqCompareResponse, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BoqTreeService } from '../application/boq-tree.service.js';
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
  function controller() {
    const treeService = {
      getTree: jest.fn(async () => [section]),
      updateNode: jest.fn(async () => ({ ...leaf, children: undefined })),
    };
    return new BoqController({} as never, treeService as never, {} as never, {} as never);
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

  it('withholds money from the node a money-blind editor just saved', async () => {
    const node = await controller().updateNode(scopeOnly, 'p', 'v', 'n-2', { description: 'x' });
    expect(node).toMatchObject({ unitRate: null, totalAmount: null });
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
});
