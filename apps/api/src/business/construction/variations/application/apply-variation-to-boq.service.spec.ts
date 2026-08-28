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

function build(opts: { vo?: ReturnType<typeof makeVo>; append?: jest.Mock } = {}) {
  const prisma = { $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({})) };
  const tenancy = { getClient: () => prisma } as never;

  const repo = {
    findForApply: jest.fn(async () => opts.vo ?? makeVo()),
    markBoqApplied: jest.fn(async () => undefined),
  };
  const projectAccess = { assertContract: jest.fn().mockResolvedValue(undefined) };
  const auditOutbox = { record: jest.fn().mockResolvedValue(undefined) };
  const append =
    opts.append ?? jest.fn(async () => ({ versionId: 'v-2', nodeCount: 2 }));
  const boqVersioning = { appendVariationNodes: append };

  const service = new ApplyVariationToBoqService(
    tenancy,
    repo as never,
    projectAccess as never,
    auditOutbox as never,
    boqVersioning as never,
  );
  return { service, repo, append, auditOutbox };
}

describe('ApplyVariationToBoqService (CONST-VAR-007)', () => {
  it('scopes a CLIENT_APPROVED VO into the BOQ, marks it applied, and audits', async () => {
    const { service, repo, append, auditOutbox } = build();

    const res = await service.apply(identity, 'vo-1');

    expect(append).toHaveBeenCalledTimes(1);
    // The VO's lines (including the signed-negative omission) are passed through verbatim.
    const passed = append.mock.calls[0]![3] as { lines: unknown[]; id: string };
    expect(passed.id).toBe('vo-1');
    expect(passed.lines).toHaveLength(2);
    expect(repo.markBoqApplied).toHaveBeenCalledWith(
      expect.anything(),
      'vo-1',
      expect.objectContaining({ boqAppliedVersionId: 'v-2', boqAppliedBy: 'u1' }),
    );
    expect(auditOutbox.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'VARIATION_ORDER_APPLIED_TO_BOQ' }),
    );
    expect(res).toMatchObject({ boqVersionId: 'v-2', nodeCount: 2, reference: 'VO-001' });
  });

  it('rejects a VO that is not CLIENT_APPROVED', async () => {
    const { service, append } = build({ vo: makeVo({ status: 'INTERNAL_APPROVED' }) });
    await expect(service.apply(identity, 'vo-1')).rejects.toBeInstanceOf(ConflictException);
    expect(append).not.toHaveBeenCalled();
  });

  it('is idempotent — a VO already applied cannot be applied again', async () => {
    const { service, append } = build({
      vo: makeVo({ boqAppliedAt: new Date('2026-08-28T00:00:00Z'), boqAppliedVersionId: 'v-2' }),
    });
    await expect(service.apply(identity, 'vo-1')).rejects.toBeInstanceOf(ConflictException);
    expect(append).not.toHaveBeenCalled();
  });

  it('404s when the VO does not exist', async () => {
    const { service, repo } = build();
    repo.findForApply.mockResolvedValueOnce(null as never);
    await expect(service.apply(identity, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
