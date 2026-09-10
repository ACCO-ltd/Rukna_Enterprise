import { ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { ApplyVariationToBoqService } from './apply-variation-to-boq.service.js';

const identity = {
  userId: 'u1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
} as never;

function makeVo(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'vo-1',
    organizationId: 'org-1',
    contractId: 'c-1',
    reference: 'VO-001',
    status: 'CLIENT_APPROVED',
    boqAppliedAt: null,
    boqAppliedVersionId: null,
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
  append?: jest.Mock;
  raise?: jest.Mock;
} = {}) {
  const prisma = { $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({})) };
  const tenancy = { getClient: () => prisma } as never;

  const repo = {
    findForApply: jest.fn(async () => opts.vo ?? makeVo()),
    markBoqApplied: jest.fn(async () => undefined),
  };
  const projectAccess = { assertContract: jest.fn().mockResolvedValue(undefined) };
  const auditOutbox = { record: jest.fn().mockResolvedValue(undefined) };
  const append =
    opts.append ??
    jest.fn(async () => ({ versionId: 'v-op', snapshotVersionId: 'v-snap', nodeCount: 2 }));
  const boqVersioning = { appendVariationNodes: append };
  // V-2 — the Contract-side seam. Default: base 1,000,000 frozen, current rises from 1,000,000 by
  // the VO net (+900) to 1,000,900.
  const raise =
    opts.raise ??
    jest.fn(async () => ({
      previousContractValue: '1000000.00',
      newContractValue: '1000900.00',
      baseContractValue: '1000000.00',
    }));
  const contracts = { raiseCurrentValueForVariation: raise };

  const service = new ApplyVariationToBoqService(
    tenancy,
    repo as never,
    projectAccess as never,
    auditOutbox as never,
    boqVersioning as never,
    contracts as never,
  );
  return { service, repo, append, raise, auditOutbox };
}

describe('ApplyVariationToBoqService (ADR-029 V-1/V-2, was CONST-VAR-007)', () => {
  it('V-1: appends the VO in place and passes the signed lines through verbatim', async () => {
    const { service, append } = build();

    await service.apply(identity, 'vo-1');

    expect(append).toHaveBeenCalledTimes(1);
    const passed = append.mock.calls[0]![3] as { lines: unknown[]; id: string };
    expect(passed.id).toBe('vo-1');
    // The VO's lines (including the signed-negative omission) are passed through verbatim.
    expect(passed.lines).toHaveLength(2);
  });

  it('V-2: raises the current value by the VO net, base unchanged, snapshot created, stamps applied, audits', async () => {
    const { service, repo, raise, auditOutbox } = build();

    const res = await service.apply(identity, 'vo-1');

    // The raise is driven through the Contract-side seam with the VO net (1000 + (−100) = 900).
    expect(raise).toHaveBeenCalledTimes(1);
    const raiseArgs = raise.mock.calls[0]!;
    expect(raiseArgs[2]).toBe('c-1'); // contractId
    expect((raiseArgs[3] as { netDelta: Decimal }).netDelta.toFixed(2)).toBe('900.00');

    // The VO is stamped applied against the operational version (idempotency marker).
    expect(repo.markBoqApplied).toHaveBeenCalledWith(
      expect.anything(),
      'vo-1',
      expect.objectContaining({ boqAppliedVersionId: 'v-op', boqAppliedBy: 'u1' }),
    );

    // The audit event records the snapshot + the before/after current value; base is never in it.
    expect(auditOutbox.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'VARIATION_ORDER_APPLIED_TO_BOQ',
        after: expect.objectContaining({
          snapshotVersionId: 'v-snap',
          netDelta: '900.00',
          previousContractValue: '1000000.00',
          newContractValue: '1000900.00',
        }),
      }),
    );

    // The response surfaces the current value after the raise + the frozen snapshot.
    expect(res).toMatchObject({
      boqVersionId: 'v-op',
      snapshotVersionId: 'v-snap',
      nodeCount: 2,
      reference: 'VO-001',
      newContractValue: '1000900.00',
    });
  });

  it('rejects a VO that is not CLIENT_APPROVED (no append, no raise)', async () => {
    const { service, append, raise } = build({ vo: makeVo({ status: 'INTERNAL_APPROVED' }) });
    await expect(service.apply(identity, 'vo-1')).rejects.toBeInstanceOf(ConflictException);
    expect(append).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });

  it('V-2: re-adopt is a 409 — a VO already applied cannot be applied again (idempotency)', async () => {
    const { service, append, raise } = build({
      vo: makeVo({ boqAppliedAt: new Date('2026-09-10T00:00:00Z'), boqAppliedVersionId: 'v-op' }),
    });
    await expect(service.apply(identity, 'vo-1')).rejects.toBeInstanceOf(ConflictException);
    expect(append).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });

  it('404s when the VO does not exist', async () => {
    const { service, repo } = build();
    repo.findForApply.mockResolvedValueOnce(null as never);
    await expect(service.apply(identity, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
