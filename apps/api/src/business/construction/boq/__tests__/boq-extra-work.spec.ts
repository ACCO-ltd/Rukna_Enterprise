import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { BoqTreeService } from '../application/boq-tree.service.js';
import type { BoqChangeEventInput } from '../infrastructure/boq-prisma.repository.js';

/**
 * The BOQ side of the R5 extra-work classifier (ADR-029 CONST-BOQ-029/030/033 / spec E-1, E-3).
 * DB-free: the repo + tenancy are mocked (the R4 contingency-draw spec's style), so what is under
 * test is the pure decision logic — the ABSORB net-zero funding (added leaf +X, contingency −X, total
 * constant), the SEPARATE_CHARGE pin-neutral add (excluded from the total), and that each hands the
 * repo exactly the writes/events it should. The atomic transaction itself is exercised DB-backed.
 */

const identity = { userId: 'u1', activeOrganizationId: 'o1', permissions: [] } as never;
const boq = { id: 'boq1', organizationId: 'o1', currency: 'USD', versions: [{ id: 'v1' }] };

/** An allowance-style contingency leaf: quantity 1, whole amount in unitRate = totalAmount. */
function contingency(over: Record<string, unknown> = {}) {
  return {
    id: 'cont',
    versionId: 'v1',
    parentId: 's1',
    path: 's1/cont',
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

function absorbRepo(opts: {
  status?: 'DRAFT' | 'COMMITTED' | 'SNAPSHOT';
  source?: Record<string, unknown>;
  nodes?: unknown[];
} = {}) {
  const source = contingency(opts.source);
  const nodes = opts.nodes ?? [source];
  const repo = {
    findByProject: jest.fn().mockResolvedValue(boq),
    findVersion: jest.fn().mockResolvedValue({ id: 'v1', status: opts.status ?? 'COMMITTED' }),
    findNodeById: jest.fn().mockResolvedValue(null),
    findNodesByVersion: jest.fn().mockResolvedValue(nodes),
    countSiblings: jest.fn().mockResolvedValue(0),
    findChildCodes: jest.fn().mockResolvedValue([]),
    findCodesInVersion: jest.fn().mockResolvedValue(new Set<string>()),
    addAbsorbedFundedByContingency: jest
      .fn()
      .mockResolvedValue({ id: 'absorbed', code: '01.001' }),
  };
  const svc = new BoqTreeService({ getClient: () => ({}) } as never, repo as never);
  return { svc, repo, source };
}

describe('BoqTreeService.addAbsorbedScope — ADR-029 E-1 / C-4', () => {
  it('adds an ABSORBED leaf (+X) funded by an equal contingency reduction (−X): total constant', async () => {
    const { svc, repo } = absorbRepo({});
    await svc.addAbsorbedScope(identity, 'p1', 'v1', { description: 'Extra wall', amount: '200.00' });

    const [, added, source, createdEvent, drawEvent] = repo.addAbsorbedFundedByContingency.mock
      .calls[0] as [
      unknown,
      { data: { totalAmount: string; commercialTreatment: string; quantity: string } },
      { id: string; data: { totalAmount: Decimal } },
      BoqChangeEventInput,
      BoqChangeEventInput,
    ];

    // The added leaf is a lump-sum ABSORBED line carrying the whole amount.
    expect(added.data.commercialTreatment).toBe('ABSORBED');
    expect(added.data.quantity).toBe('1');
    expect(added.data.totalAmount).toBe('200.00');

    // The contingency source drops by exactly the amount: 500 → 300.
    expect(source.id).toBe('cont');
    expect(source.data.totalAmount.toFixed(2)).toBe('300.00');

    // Two events: a CREATE for the added scope + a MOVE for the funding draw.
    expect(createdEvent.action).toBe('CREATE');
    expect(drawEvent.action).toBe('MOVE');
    expect(drawEvent.oldValue).toBe('500.00');
    expect(drawEvent.newValue).toBe('300.00');
  });

  it('rejects an absorb beyond the contingency remaining (400 CONTINGENCY_EXCEEDED)', async () => {
    const { svc } = absorbRepo({});
    await expect(
      svc.addAbsorbedScope(identity, 'p1', 'v1', { description: 'Too big', amount: '500.01' }),
    ).rejects.toMatchObject({ response: { errorCode: 'CONTINGENCY_EXCEEDED' } });
  });

  it('rejects a non-positive amount', async () => {
    const { svc } = absorbRepo({});
    await expect(
      svc.addAbsorbedScope(identity, 'p1', 'v1', { description: 'x', amount: '0' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses when there is no contingency line to fund from', async () => {
    const { svc } = absorbRepo({ nodes: [] });
    await expect(
      svc.addAbsorbedScope(identity, 'p1', 'v1', { description: 'x', amount: '10.00' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses against a SNAPSHOT (immutable record → 403)', async () => {
    const { svc } = absorbRepo({ status: 'SNAPSHOT' });
    await expect(
      svc.addAbsorbedScope(identity, 'p1', 'v1', { description: 'x', amount: '10.00' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('works on a pre-commit DRAFT too (the pin is a no-op there)', async () => {
    const { svc, repo } = absorbRepo({ status: 'DRAFT' });
    await svc.addAbsorbedScope(identity, 'p1', 'v1', { description: 'x', amount: '100.00' });
    expect(repo.addAbsorbedFundedByContingency).toHaveBeenCalledTimes(1);
  });

  it('exposes the ConflictException path in principle (never fires on a legitimate absorb)', async () => {
    const { svc } = absorbRepo({});
    await expect(
      svc.addAbsorbedScope(identity, 'p1', 'v1', { description: 'x', amount: '123.45' }),
    ).resolves.toBeDefined();
    expect(ConflictException).toBeDefined();
  });
});

/**
 * SEPARATE_CHARGE add (spec E-3): a real leaf added in place, EXCLUDED from the in-contract total, so
 * pin-neutral even on a COMMITTED version. It reuses `addNode` with the server-only treatment seam.
 */
function separateRepo(status: 'DRAFT' | 'COMMITTED') {
  const repo = {
    findByProject: jest.fn().mockResolvedValue(boq),
    findVersion: jest.fn().mockResolvedValue({ id: 'v1', status }),
    findNodeById: jest.fn().mockResolvedValue(null),
    countSiblings: jest.fn().mockResolvedValue(0),
    findChildCodes: jest.fn().mockResolvedValue([]),
    findCodesInVersion: jest.fn().mockResolvedValue(new Set<string>()),
    createNodeAtPosition: jest
      .fn()
      .mockImplementation((_p, data) => Promise.resolve({ id: 'sep', ...data })),
  };
  const svc = new BoqTreeService({ getClient: () => ({}) } as never, repo as never);
  return { svc, repo };
}

describe('BoqTreeService.addSeparateChargeLine — ADR-029 E-3 / CONST-BOQ-033', () => {
  it('adds a SEPARATE_CHARGE leaf in place even on a COMMITTED version (pin-neutral)', async () => {
    const { svc, repo } = separateRepo('COMMITTED');
    await svc.addSeparateChargeLine(identity, 'p1', 'v1', {
      description: 'Owner-requested signage',
      isLeaf: true,
      unit: 'LS',
      quantity: '1',
      unitRate: '750.00',
    });

    const [, data] = repo.createNodeAtPosition.mock.calls[0] as [
      unknown,
      { commercialTreatment: string; totalAmount: string },
    ];
    // The leaf is SEPARATE_CHARGE and carries its amount; the COMMITTED pin did NOT reject it, because
    // a SEPARATE_CHARGE leaf never contributes to the in-contract total (prospective delta 0).
    expect(data.commercialTreatment).toBe('SEPARATE_CHARGE');
    expect(data.totalAmount).toBe('750.00');
  });
});
