import { Decimal } from '@prisma/client/runtime/library';

import { BoqTreeService } from './boq-tree.service.js';
import type { BoqChangeEventInput } from '../infrastructure/boq-prisma.repository.js';

/**
 * The change-log wiring (BOQ refinement Phase 1). Repos are mocked; what's under test is that each
 * mutation hands the repo the right event, that an UPDATE diffs field-by-field (and treats a decimal
 * reformat as no change), and that `getHistory` maps rows + resolves actor names.
 */
const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;

const boq = { id: 'boq1', organizationId: 'o1', currency: 'USD', versions: [{ id: 'v1' }] };

function leaf(over: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    versionId: 'v1',
    parentId: null,
    path: 'n1',
    depth: 2,
    sortOrder: 0,
    code: '02.01.001',
    description: 'Mass concrete',
    isLeaf: true,
    unit: 'm3',
    quantity: new Decimal('10'),
    unitRate: new Decimal('80'),
    measurementMethod: 'QUANTITY',
    pricingBasis: 'UNIT_RATE',
    ...over,
  };
}

function build(over: { node?: unknown; history?: unknown[]; actorNames?: Map<string, string> } = {}) {
  const repo = {
    findByProject: jest.fn().mockResolvedValue(boq),
    findVersion: jest.fn().mockResolvedValue({ id: 'v1', status: 'DRAFT' }),
    findNodeById: jest.fn().mockResolvedValue(over.node ?? leaf()),
    countChildren: jest.fn().mockResolvedValue(0),
    countSiblings: jest.fn().mockResolvedValue(0),
    findCodesInVersion: jest.fn().mockResolvedValue(new Set<string>()),
    findChildCodes: jest.fn().mockResolvedValue([]),
    countNodeReferences: jest.fn().mockResolvedValue([]),
    findNodesByVersion: jest.fn().mockResolvedValue([]),
    createNodeAtPosition: jest.fn().mockResolvedValue(leaf()),
    updateNode: jest.fn().mockResolvedValue(leaf()),
    deleteNodeAndReindex: jest.fn().mockResolvedValue(undefined),
    moveNode: jest.fn().mockResolvedValue(undefined),
    findHistory: jest.fn().mockResolvedValue(over.history ?? []),
    findActorNames: jest.fn().mockResolvedValue(over.actorNames ?? new Map()),
  };
  const tenancy = { getClient: () => ({}) };
  const svc = new BoqTreeService(tenancy as never, repo as never);
  return { svc, repo };
}

const dto = (over: Record<string, unknown>) => over as never;

function eventArg(mock: jest.Mock, index: number): BoqChangeEventInput {
  return mock.mock.calls[0][index] as BoqChangeEventInput;
}

describe('BoqTreeService — change history', () => {
  describe('add', () => {
    it('records a CREATE event alongside the new node', async () => {
      const { svc, repo } = build();
      await svc.addNode(identity, 'p1', 'v1', dto({ code: '02.01.002', description: 'Rebar', isLeaf: true, unit: 'kg', quantity: '5', unitRate: '2.00' }));
      const event = eventArg(repo.createNodeAtPosition, 4);
      expect(event.action).toBe('CREATE');
      expect(event.code).toBe('02.01.002');
      expect(event.actorUserId).toBe('u1');
    });

    it('auto-assigns the code from tree position when none is given (D2)', async () => {
      const { svc, repo } = build();
      await svc.addNode(identity, 'p1', 'v1', dto({ description: 'Concrete works', isLeaf: false }));
      const data = repo.createNodeAtPosition.mock.calls[0][1] as { code: string };
      expect(data.code).toBe('01');
      expect(eventArg(repo.createNodeAtPosition, 4).code).toBe('01');
    });

    it('uses a provided code as an override', async () => {
      const { svc, repo } = build();
      await svc.addNode(identity, 'p1', 'v1', dto({ code: '99.99', description: 'x', isLeaf: false }));
      const data = repo.createNodeAtPosition.mock.calls[0][1] as { code: string };
      expect(data.code).toBe('99.99');
    });
  });

  describe('update', () => {
    it('records a field-level event for a changed rate, with before/after', async () => {
      const { svc, repo } = build();
      await svc.updateNode(identity, 'p1', 'v1', 'n1', dto({ unitRate: '85.00' }));
      const events = repo.updateNode.mock.calls[0][3] as BoqChangeEventInput[];
      const rate = events.find((e) => e.field === 'unitRate');
      expect(rate).toBeDefined();
      expect(rate!.action).toBe('UPDATE');
      expect(rate!.oldValue).toBe('80');
      expect(rate!.newValue).toBe('85.00');
    });

    it('does not record a change when a value only reformats (10 vs 10.00)', async () => {
      const { svc, repo } = build();
      await svc.updateNode(identity, 'p1', 'v1', 'n1', dto({ quantity: '10.00' }));
      const events = repo.updateNode.mock.calls[0][3] as BoqChangeEventInput[];
      expect(events.some((e) => e.field === 'quantity')).toBe(false);
    });

    it('records a description change and leaves untouched fields alone', async () => {
      const { svc, repo } = build();
      await svc.updateNode(identity, 'p1', 'v1', 'n1', dto({ description: 'Mass concrete C30' }));
      const events = repo.updateNode.mock.calls[0][3] as BoqChangeEventInput[];
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ field: 'description', oldValue: 'Mass concrete', newValue: 'Mass concrete C30' });
    });
  });

  describe('delete', () => {
    it('records a DELETE event', async () => {
      const { svc, repo } = build();
      await svc.deleteNode(identity, 'p1', 'v1', 'n1');
      const event = eventArg(repo.deleteNodeAndReindex, 2);
      expect(event.action).toBe('DELETE');
      expect(event.code).toBe('02.01.001');
    });
  });

  describe('move', () => {
    it('records a MOVE event', async () => {
      const { svc, repo } = build();
      await svc.moveNode(identity, 'p1', 'v1', 'n1', dto({ newSortOrder: 3 }));
      const event = repo.moveNode.mock.calls[0][7] as BoqChangeEventInput;
      expect(event.action).toBe('MOVE');
      expect(event.code).toBe('02.01.001');
    });
  });

  describe('getHistory', () => {
    it('maps rows and resolves the actor name', async () => {
      const row = {
        id: 'e1',
        versionId: 'v1',
        nodeId: 'n1',
        code: '02.01.001',
        action: 'UPDATE',
        field: 'unitRate',
        oldValue: '80',
        newValue: '85.00',
        detail: null,
        actorUserId: 'u1',
        createdAt: new Date('2026-09-03T14:22:00.000Z'),
      };
      const { svc } = build({ history: [row], actorNames: new Map([['u1', 'Ahmed Shirie']]) });
      const result = await svc.getHistory(identity, 'p1', 'v1', { take: 100, skip: 0 });
      expect(result[0]).toMatchObject({
        field: 'unitRate',
        oldValue: '80',
        newValue: '85.00',
        actorName: 'Ahmed Shirie',
        createdAt: '2026-09-03T14:22:00.000Z',
      });
    });
  });
});
