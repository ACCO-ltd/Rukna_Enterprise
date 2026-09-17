import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { VariationOrderService } from './variation-order.service.js';

const identity = {
  userId: 'u1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
} as never;

// A mutable in-memory VO the mock repo reads back, so a transition is observable across calls.
function makeVo(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'vo-1',
    organizationId: 'org-1',
    contractId: 'c-1',
    reference: 'VO-001',
    status: 'DRAFT',
    title: 'Extra floor',
    description: null,
    proposedTimeImpactDays: null,
    createdBy: 'u1',
    submittedBy: null,
    submittedAt: null,
    internalApprovedBy: null,
    internalApprovedAt: null,
    clientApprovedBy: null,
    clientApprovedAt: null,
    clientApprovalReference: null,
    rejectedBy: null,
    rejectedAt: null,
    reason: null,
    boqAppliedAt: null,
    boqAppliedBy: null,
    boqAppliedVersionId: null,
    createdAt: new Date('2026-08-27T00:00:00Z'),
    updatedAt: new Date('2026-08-27T00:00:00Z'),
    lines: [
      { id: 'l1', description: 'A', quantity: new Decimal('10'), unitRate: new Decimal('100'), amount: new Decimal('1000'), sortOrder: 0 },
    ],
    ...over,
  };
}

// variation-collapse: the governance dependency was removed (the approval workflow is gone), so the
// service is now constructed with four deps (tenancy, repo, projectAccess, auditOutbox).
function build(opts: { vo?: ReturnType<typeof makeVo>; assertContract?: jest.Mock } = {}) {
  const state = { vo: opts.vo ?? makeVo() };
  const prisma = { $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({})) };
  const tenancy = { getClient: () => prisma } as never;

  const repo = {
    findContract: jest.fn().mockResolvedValue({
      id: 'c-1',
      projectId: 'p-1',
      organizationId: 'org-1',
      contractValue: new Decimal('1000000'),
      currency: 'USD',
      status: 'ACTIVE',
    }),
    nextReferenceSeq: jest.fn().mockResolvedValue(1),
    findById: jest.fn(async () => state.vo),
    findByContract: jest.fn(async () => [state.vo]),
    create: jest.fn(async () => state.vo),
    updateHeader: jest.fn(async () => undefined),
    addLine: jest.fn(async () => ({ id: 'l2', amount: new Decimal('0') })),
    findLineOwned: jest.fn(async () => state.vo.lines[0]),
    updateLine: jest.fn(async () => ({ count: 1 })),
    removeLine: jest.fn(async () => ({ count: 1 })),
    transition: jest.fn(async (_tx: unknown, _id: string, status: string, meta: Record<string, unknown>) => {
      state.vo = makeVo({ ...state.vo, status, ...meta });
      return state.vo;
    }),
    countBoqNodes: jest.fn(async () => 0),
  };
  const projectAccess = {
    assertContract: opts.assertContract ?? jest.fn().mockResolvedValue(undefined),
  };
  const auditOutbox = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new VariationOrderService(
    tenancy,
    repo as never,
    projectAccess as never,
    auditOutbox as never,
  );
  return { service, repo, projectAccess, auditOutbox, state };
}

describe('VariationOrderService — create (ADR-026)', () => {
  it('create assigns the next per-contract reference VO-001 and derives net price from lines', async () => {
    const { service, repo } = build();
    const res = await service.create(identity, 'c-1', {
      title: 'Extra floor',
      lines: [{ description: 'A', quantity: 10, unitRate: 100 }],
    });
    expect(repo.nextReferenceSeq).toHaveBeenCalledWith(expect.anything(), 'c-1');
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reference: 'VO-001', contractId: 'c-1' }),
    );
    expect(res.reference).toBe('VO-001');
    expect(res.netPrice).toBe('1000.00');
  });

  it('create fails when the contract is not found in the caller\'s org', async () => {
    const { service, repo } = build();
    repo.findContract.mockResolvedValueOnce(null);
    await expect(
      service.create(identity, 'c-x', { title: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('VariationOrderService — retraction commands (reject / withdraw) survive the collapse', () => {
  it('reject requires the VO to be pre-client and moves it to REJECTED with a reason', async () => {
    const { service, state } = build({ vo: makeVo({ status: 'DRAFT' }) });
    await service.reject(identity, 'vo-1', { reason: 'Client declined' });
    expect(state.vo.status).toBe('REJECTED');
    expect(state.vo.reason).toBe('Client declined');
  });

  it('withdraw moves a pre-client VO to WITHDRAWN (optional reason)', async () => {
    const { service, state } = build({ vo: makeVo({ status: 'DRAFT' }) });
    await service.withdraw(identity, 'vo-1', { reason: 'Superseded' });
    expect(state.vo.status).toBe('WITHDRAWN');
    expect(state.vo.reason).toBe('Superseded');
  });

  it('there is no un-approve here: reject on a CLIENT_APPROVED VO is a 409', async () => {
    const { service } = build({ vo: makeVo({ status: 'CLIENT_APPROVED' }) });
    await expect(
      service.reject(identity, 'vo-1', { reason: 'too late' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('VariationOrderService — guards (CONST-VAR-004)', () => {
  it('closes field editing after DRAFT (addLine on a client-approved VO → 409)', async () => {
    const { service, repo } = build({ vo: makeVo({ status: 'CLIENT_APPROVED' }) });
    await expect(
      service.addLine(identity, 'vo-1', { description: 'B', quantity: 1, unitRate: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.addLine).not.toHaveBeenCalled();
  });
});

describe('VariationOrderService — variation billing realization (allocateVariationBilling)', () => {
  function buildForAllocate(voStatus: string) {
    const state = { vo: makeVo({ status: voStatus, lines: [{ id: 'l1', description: 'A', quantity: new Decimal('10'), unitRate: new Decimal('100'), amount: new Decimal('1000'), sortOrder: 0 }] }) };
    const inner = { $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({})) };
    const prisma = { ...inner };
    const tenancy = { getClient: () => prisma } as never;
    const repo = {
      findById: jest.fn(async () => state.vo),
      findAllocationsByVariation: jest.fn(async () => []),
      createAllocation: jest.fn(async () => ({ id: 'alloc-1' })),
      countBoqNodes: jest.fn(async () => 0),
    };
    const projectAccess = { assertContract: jest.fn().mockResolvedValue(undefined) };
    const auditOutbox = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new VariationOrderService(tenancy, repo as never, projectAccess as never, auditOutbox as never);
    return { service, repo };
  }

  it('records an INVOICE allocation for a CLIENT_APPROVED VO (net headroom respected)', async () => {
    const { service, repo } = buildForAllocate('CLIENT_APPROVED');
    const res = await service.allocateVariationBilling(identity, 'vo-1', {
      amount: '400',
      treatment: 'INVOICE',
    });
    expect(repo.createAllocation).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ amount: '400.00', treatment: 'INVOICE', netValue: '1000.00' });
  });

  it('refuses to bill a VO that is not client-approved (409)', async () => {
    const { service, repo } = buildForAllocate('DRAFT');
    await expect(
      service.allocateVariationBilling(identity, 'vo-1', { amount: '400', treatment: 'INVOICE' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.createAllocation).not.toHaveBeenCalled();
  });
});

describe('VariationOrderService — tenant / membership isolation', () => {
  it('a non-member cannot read another tenant\'s variation (assertContract throws)', async () => {
    const denied = jest.fn().mockRejectedValue(new ForbiddenException());
    const { service } = build({ assertContract: denied });
    await expect(service.findOne(identity, 'vo-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
