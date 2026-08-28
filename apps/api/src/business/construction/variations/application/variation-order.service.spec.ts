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

function build(opts: { vo?: ReturnType<typeof makeVo>; gate?: unknown; assertContract?: jest.Mock } = {}) {
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
  const governance = { gateStateTransition: jest.fn().mockResolvedValue(opts.gate ?? null) };

  const service = new VariationOrderService(
    tenancy,
    repo as never,
    projectAccess as never,
    auditOutbox as never,
    governance as never,
  );
  return { service, repo, projectAccess, auditOutbox, governance, state };
}

describe('VariationOrderService — happy path lifecycle (ADR-026)', () => {
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

  it('create → submit → internal-approve → client-approve walks the state machine', async () => {
    const { service, state } = build();

    await service.submit(identity, 'vo-1');
    expect(state.vo.status).toBe('PENDING_INTERNAL');
    expect(state.vo.submittedBy).toBe('u1');

    await service.internalApprove(identity, 'vo-1');
    expect(state.vo.status).toBe('INTERNAL_APPROVED');

    const res = await service.clientApprove(identity, 'vo-1', {
      clientApprovalReference: 'SIGNED-VO-001',
    });
    expect(state.vo.status).toBe('CLIENT_APPROVED');
    expect(res.clientApprovalReference).toBe('SIGNED-VO-001');
  });
});

describe('VariationOrderService — guards (CONST-VAR-004)', () => {
  it('rejects an illegal transition (client-approve on a DRAFT) with 409', async () => {
    const { service } = build({ vo: makeVo({ status: 'DRAFT' }) });
    await expect(
      service.clientApprove(identity, 'vo-1', { clientApprovalReference: 'X' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('closes field editing after PENDING_INTERNAL (addLine on a submitted VO → 409)', async () => {
    const { service, repo } = build({ vo: makeVo({ status: 'PENDING_INTERNAL' }) });
    await expect(
      service.addLine(identity, 'vo-1', { description: 'B', quantity: 1, unitRate: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.addLine).not.toHaveBeenCalled();
  });

  it('reject requires the VO to be pre-client and moves it to REJECTED with a reason', async () => {
    const { service, state } = build({ vo: makeVo({ status: 'PENDING_INTERNAL' }) });
    await service.reject(identity, 'vo-1', { reason: 'Client declined' });
    expect(state.vo.status).toBe('REJECTED');
    expect(state.vo.reason).toBe('Client declined');
  });
});

describe('VariationOrderService — internal approval governance gate (CONST-VAR-010)', () => {
  it('routes through gateStateTransition on |net price| and proceeds when the gate is null', async () => {
    const { service, governance, state } = build({ vo: makeVo({ status: 'PENDING_INTERNAL' }) });
    await service.internalApprove(identity, 'vo-1');
    expect(governance.gateStateTransition).toHaveBeenCalledWith(
      identity,
      'VariationOrder',
      'PENDING_INTERNAL',
      'INTERNAL_APPROVED',
      'vo-1',
      expect.objectContaining({ constructor: Decimal }),
    );
    expect(state.vo.status).toBe('INTERNAL_APPROVED');
  });

  it('bands on the ABSOLUTE net price so a large omission is governed like a large addition', async () => {
    const omissionVo = makeVo({
      status: 'PENDING_INTERNAL',
      lines: [{ id: 'l1', description: 'omit', quantity: new Decimal('-1'), unitRate: new Decimal('80000'), amount: new Decimal('-80000'), sortOrder: 0 }],
    });
    const { service, governance } = build({ vo: omissionVo });
    await service.internalApprove(identity, 'vo-1');
    const amountArg = governance.gateStateTransition.mock.calls[0][5] as Decimal;
    expect(amountArg.toFixed(2)).toBe('80000.00'); // abs(-80000)
  });

  it('gates (409 + approvalInstanceId) without transitioning when a binding resolves', async () => {
    const { service, governance, repo } = build({
      vo: makeVo({ status: 'PENDING_INTERNAL' }),
      gate: { gated: true, approvalInstanceId: 'ai-9' },
    });
    await expect(service.internalApprove(identity, 'vo-1')).rejects.toBeInstanceOf(ConflictException);
    expect(governance.gateStateTransition).toHaveBeenCalled();
    expect(repo.transition).not.toHaveBeenCalled();
  });
});

describe('VariationOrderService — tenant / membership isolation', () => {
  it('a non-member cannot read another tenant\'s variation (assertContract throws)', async () => {
    const denied = jest.fn().mockRejectedValue(new ForbiddenException());
    const { service } = build({ assertContract: denied });
    await expect(service.findOne(identity, 'vo-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('create fails when the contract is not found in the caller\'s org', async () => {
    const { service, repo } = build();
    repo.findContract.mockResolvedValueOnce(null);
    await expect(
      service.create(identity, 'c-x', { title: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
