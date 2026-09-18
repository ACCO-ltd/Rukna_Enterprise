import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { BoqTreeService } from '../application/boq-tree.service.js';
import type { BoqChangeEventInput } from '../infrastructure/boq-prisma.repository.js';

/**
 * The BOQ side of the R5 extra-work classifier (ADR-029 CONST-BOQ-029/030/033 / spec E-1, E-3).
 * DB-free: the repo + tenancy are mocked, so what is under test is the pure decision logic —
 * ABSORB adds an internal cost leaf (excluded from the in-contract total, no contingency draw),
 * SEPARATE_CHARGE adds a pin-neutral leaf (also excluded from total), and that each hands the
 * repo exactly the writes/events it should. The atomic transaction itself is exercised DB-backed.
 */

const identity = { userId: 'u1', activeOrganizationId: 'o1', permissions: [] } as never;
const boq = { id: 'boq1', organizationId: 'o1', currency: 'USD', versions: [{ id: 'v1' }] };

function absorbRepo(opts: {
  status?: 'DRAFT' | 'COMMITTED' | 'SNAPSHOT';
} = {}) {
  const repo = {
    findByProject: jest.fn().mockResolvedValue(boq),
    findVersion: jest.fn().mockResolvedValue({ id: 'v1', status: opts.status ?? 'COMMITTED' }),
    findNodeById: jest.fn().mockResolvedValue(null),
    countSiblings: jest.fn().mockResolvedValue(0),
    findChildCodes: jest.fn().mockResolvedValue([]),
    findCodesInVersion: jest.fn().mockResolvedValue(new Set<string>()),
    createNodeAtPosition: jest
      .fn()
      .mockResolvedValue({ id: 'absorbed', code: '01.001', commercialTreatment: 'ABSORBED' }),
  };
  const svc = new BoqTreeService({ getClient: () => ({}) } as never, repo as never);
  return { svc, repo };
}

describe('BoqTreeService.addAbsorbedScope — ADR-029 E-1 / C-4 (Slice 2: no contingency draw)', () => {
  it('adds an ABSORBED leaf (internal cost record, excluded from contract total): no contingency touched', async () => {
    const { svc, repo } = absorbRepo({});
    await svc.addAbsorbedScope(identity, 'p1', 'v1', { description: 'Extra wall', amount: '200.00' });

    expect(repo.createNodeAtPosition).toHaveBeenCalledTimes(1);
    const [, nodeData, , , event] = repo.createNodeAtPosition.mock.calls[0] as [
      unknown,
      { commercialTreatment: string; quantity: string; totalAmount: string },
      unknown,
      unknown,
      BoqChangeEventInput,
    ];

    expect(nodeData.commercialTreatment).toBe('ABSORBED');
    expect(nodeData.quantity).toBe('1');
    expect(nodeData.totalAmount).toBe('200.00');
    // One CREATE event only — no MOVE (no contingency draw).
    expect(event.action).toBe('CREATE');
  });

  it('rejects a non-positive amount', async () => {
    const { svc } = absorbRepo({});
    await expect(
      svc.addAbsorbedScope(identity, 'p1', 'v1', { description: 'x', amount: '0' }),
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
    expect(repo.createNodeAtPosition).toHaveBeenCalledTimes(1);
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
