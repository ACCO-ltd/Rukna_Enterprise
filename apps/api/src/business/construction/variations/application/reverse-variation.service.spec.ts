import { ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { ReverseVariationService } from './reverse-variation.service.js';

const identity = {
  userId: 'u1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
} as never;

// A CLIENT_APPROVED, adopted VO with an addition (+1000) and an omission (−100) → net +900.
function makeVo(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'vo-1',
    organizationId: 'org-1',
    contractId: 'c-1',
    reference: 'VO-001',
    status: 'CLIENT_APPROVED',
    boqAppliedAt: new Date('2026-09-15T00:00:00Z'),
    boqAppliedVersionId: 'v-op',
    contract: { projectId: 'p-1' },
    lines: [
      { description: 'Extra floor', quantity: new Decimal('10'), unitRate: new Decimal('100'), amount: new Decimal('1000'), sortOrder: 0 },
      { description: 'Omit wall', quantity: new Decimal('-2'), unitRate: new Decimal('50'), amount: new Decimal('-100'), sortOrder: 1 },
    ],
    ...over,
  };
}

function build(opts: {
  vo?: ReturnType<typeof makeVo>;
  allocations?: Array<{ id: string; amount: Decimal; treatment: string }>;
  retract?: jest.Mock;
  lower?: jest.Mock;
} = {}) {
  const prisma = { $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({})) };
  const tenancy = { getClient: () => prisma } as never;

  const repo = {
    findForApply: jest.fn(async () => opts.vo ?? makeVo()),
    findAllocationsByVariation: jest.fn(async () => opts.allocations ?? []),
    clearBoqApplied: jest.fn(async () => undefined),
    transition: jest.fn(async () => undefined),
  };
  const projectAccess = { assertContract: jest.fn().mockResolvedValue(undefined) };
  const auditOutbox = { record: jest.fn().mockResolvedValue(undefined) };
  const retract =
    opts.retract ??
    jest.fn(async () => ({ versionId: 'v-op', snapshotVersionId: 'v-snap2', deactivatedCount: 3 }));
  const boqVersioning = { retractVariationNodes: retract };
  // base 1,000,000 frozen; current drops from 1,000,900 back to 1,000,000 by the VO net (−900).
  const lower =
    opts.lower ??
    jest.fn(async () => ({
      previousContractValue: '1000900.00',
      newContractValue: '1000000.00',
      baseContractValue: '1000000.00',
    }));
  const contracts = { lowerCurrentValueForVariation: lower };

  const service = new ReverseVariationService(
    tenancy,
    repo as never,
    projectAccess as never,
    auditOutbox as never,
    boqVersioning as never,
    contracts as never,
  );
  return { service, repo, retract, lower, auditOutbox };
}

describe('ReverseVariationService — guards (all 409)', () => {
  it('rejects a VO that is not CLIENT_APPROVED', async () => {
    const { service, retract, lower } = build({ vo: makeVo({ status: 'DRAFT' }) });
    await expect(service.reverse(identity, 'vo-1', {})).rejects.toBeInstanceOf(ConflictException);
    expect(retract).not.toHaveBeenCalled();
    expect(lower).not.toHaveBeenCalled();
  });

  it('rejects a VO that is not adopted (boqAppliedAt null)', async () => {
    const { service, retract, lower } = build({ vo: makeVo({ boqAppliedAt: null }) });
    await expect(service.reverse(identity, 'vo-1', {})).rejects.toBeInstanceOf(ConflictException);
    expect(retract).not.toHaveBeenCalled();
    expect(lower).not.toHaveBeenCalled();
  });

  it('rejects a VO that is already billed (a non-empty allocation ledger)', async () => {
    const { service, retract, lower } = build({
      allocations: [{ id: 'a1', amount: new Decimal('400'), treatment: 'INVOICE' }],
    });
    await expect(service.reverse(identity, 'vo-1', {})).rejects.toBeInstanceOf(ConflictException);
    expect(retract).not.toHaveBeenCalled();
    expect(lower).not.toHaveBeenCalled();
  });

  it('404s when the VO does not exist', async () => {
    const { service, repo } = build();
    repo.findForApply.mockResolvedValueOnce(null as never);
    await expect(service.reverse(identity, 'missing', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ReverseVariationService — happy path', () => {
  it('retracts the BOQ scope, lowers the value by the VO net, clears the marker, → WITHDRAWN, audits', async () => {
    const { service, repo, retract, lower, auditOutbox } = build();

    const res = await service.reverse(identity, 'vo-1', { reason: 'client cancelled' });

    // 1. The scope is retracted (fresh reduced snapshot cut inside retractVariationNodes).
    expect(retract).toHaveBeenCalledTimes(1);
    expect(retract).toHaveBeenCalledWith(
      expect.anything(),
      identity,
      'p-1',
      expect.objectContaining({ id: 'vo-1', reference: 'VO-001' }),
    );

    // 2. The current value is lowered by the VO net (1000 + (−100) = 900); base is untouched (the
    //    lower seam never writes baseContractValue — it returns the frozen base unchanged).
    expect(lower).toHaveBeenCalledTimes(1);
    expect((lower.mock.calls[0]![3] as { netDelta: Decimal }).netDelta.toFixed(2)).toBe('900.00');

    // 3. The applied marker is cleared.
    expect(repo.clearBoqApplied).toHaveBeenCalledWith(expect.anything(), 'vo-1');

    // 4. The VO is moved to WITHDRAWN with the reason.
    expect(repo.transition).toHaveBeenCalledWith(
      expect.anything(),
      'vo-1',
      'WITHDRAWN',
      expect.objectContaining({ reason: 'client cancelled' }),
    );

    // 5. The reversal audit event.
    expect(auditOutbox.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'VARIATION_ORDER_REVERSED',
        idempotencyKey: 'variation-reverse-vo-1',
        after: expect.objectContaining({
          status: 'WITHDRAWN',
          netDelta: '900.00',
          newContractValue: '1000000.00',
        }),
      }),
    );

    expect(res).toMatchObject({
      variationId: 'vo-1',
      reference: 'VO-001',
      boqVersionId: 'v-op',
      snapshotVersionId: 'v-snap2',
      // The reversal DEACTIVATES (soft-deletes) the VO's nodes — the response reports the count
      // deactivated, not deleted. retractVariationNodes (mocked) reports 3.
      deactivatedCount: 3,
      newContractValue: '1000000.00',
    });
  });

  it('DEACTIVATES the VO nodes (soft delete) rather than hard-deleting them', async () => {
    // The service delegates node retraction to boqVersioning.retractVariationNodes, whose contract is
    // a soft delete (isActive=false via deactivateNodesForVariation) — the count it returns is the
    // number deactivated, surfaced verbatim on the response and the audit event.
    const retract = jest.fn(async () => ({
      versionId: 'v-op',
      snapshotVersionId: 'v-snap2',
      deactivatedCount: 5,
    }));
    const { service, auditOutbox } = build({ retract });

    const res = await service.reverse(identity, 'vo-1', {});

    expect(retract).toHaveBeenCalledTimes(1);
    expect(res.deactivatedCount).toBe(5);
    expect(auditOutbox.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({ deactivatedCount: 5 }),
      }),
    );
  });
});

describe('ReverseVariationService — TOCTOU billing guard (FIX 2)', () => {
  it('re-reads the allocation ledger INSIDE the transaction and refuses if it is now non-empty', async () => {
    // The pre-tx glance sees NO allocations (so the fast pre-check passes), but a racing allocation
    // lands before the retraction — the in-tx re-read must catch it and throw, and no retraction/lower
    // may run. `findAllocationsByVariation` returns empty on the first (pre-tx) call, then a non-empty
    // ledger on the second (in-tx) call.
    const prisma = { $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({})) };
    const tenancy = { getClient: () => prisma } as never;

    const findAllocations = jest
      .fn()
      .mockResolvedValueOnce([]) // pre-tx fast check: clear
      .mockResolvedValueOnce([{ id: 'a1', amount: new Decimal('400'), treatment: 'INVOICE' }]); // in-tx: raced

    const repo = {
      findForApply: jest.fn(async () => makeVo()),
      findAllocationsByVariation: findAllocations,
      clearBoqApplied: jest.fn(async () => undefined),
      transition: jest.fn(async () => undefined),
    };
    const projectAccess = { assertContract: jest.fn().mockResolvedValue(undefined) };
    const auditOutbox = { record: jest.fn().mockResolvedValue(undefined) };
    const retract = jest.fn(async () => ({
      versionId: 'v-op',
      snapshotVersionId: 'v-snap2',
      deactivatedCount: 3,
    }));
    const lower = jest.fn(async () => ({
      previousContractValue: '1000900.00',
      newContractValue: '1000000.00',
      baseContractValue: '1000000.00',
    }));
    const boqVersioning = { retractVariationNodes: retract };
    const contracts = { lowerCurrentValueForVariation: lower };

    const service = new ReverseVariationService(
      tenancy,
      repo as never,
      projectAccess as never,
      auditOutbox as never,
      boqVersioning as never,
      contracts as never,
    );

    await expect(service.reverse(identity, 'vo-1', {})).rejects.toBeInstanceOf(ConflictException);
    // The in-tx guard fired BEFORE any retraction/lower/transition.
    expect(findAllocations).toHaveBeenCalledTimes(2);
    expect(retract).not.toHaveBeenCalled();
    expect(lower).not.toHaveBeenCalled();
    expect(repo.transition).not.toHaveBeenCalled();
  });
});
