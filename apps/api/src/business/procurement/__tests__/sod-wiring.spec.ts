import { ForbiddenException } from '@nestjs/common';

import { GoodsReceiptService } from '../goods-receipts/application/goods-receipt.service.js';
import { MaterialRequestService } from '../material-requests/application/material-request.service.js';

/**
 * ADR-022 CONST-DOA-003 — proves each procurement command hands the SoD service the right actors.
 * The SoD brain itself is covered in segregation-of-duties.service.spec; here we only assert the
 * wiring: correct action, the acting user, and the prior party pulled off the aggregate. A denying
 * stub short-circuits the command so no further collaborators need mocking.
 */
const identity = (userId: string) =>
  ({ userId, activeOrganizationId: 'o1', roles: [], permissions: [] }) as never;

const denyingSod = () => ({
  assertAllowed: jest.fn().mockRejectedValue(new ForbiddenException('SoD')),
});

describe('Procurement SoD wiring (ADR-022)', () => {
  it('goods receipt: a PO creator receiving their own order is checked as RECEIVE_GOODS', async () => {
    const sod = denyingSod();
    const poRepo = {
      findById: jest.fn().mockResolvedValue({ id: 'po1', status: 'OPEN', createdBy: 'alice', revisions: [] }),
    };
    const svc = new GoodsReceiptService(
      { getClient: () => ({}) } as never,
      {} as never,
      poRepo as never,
      {} as never,
      {} as never,
      sod as never,
    );

    await expect(
      svc.create(identity('alice'), { purchaseOrderId: 'po1', deliveryDate: '2026-09-01', lines: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(sod.assertAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RECEIVE_GOODS',
        actorUserId: 'alice',
        purchaseOrderCreatorUserId: 'alice',
      }),
    );
  });

  it('material request: approving is checked as APPROVE_MATERIAL_REQUEST against the requester', async () => {
    const sod = denyingSod();
    const mrRepo = {
      findById: jest.fn().mockResolvedValue({ id: 'mr1', status: 'SUBMITTED', requestedBy: 'alice', projectId: null }),
    };
    const svc = new MaterialRequestService(
      { getClient: () => ({}) } as never,
      mrRepo as never,
      {} as never,
      {} as never,
      { assertMember: jest.fn() } as never,
      { record: jest.fn() } as never,
      sod as never,
    );

    await expect(svc.approve(identity('alice'), 'mr1')).rejects.toBeInstanceOf(ForbiddenException);

    expect(sod.assertAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPROVE_MATERIAL_REQUEST',
        actorUserId: 'alice',
        requesterUserId: 'alice',
      }),
    );
  });

  it('material request: a non-approve transition (submit) does not invoke SoD', async () => {
    const sod = denyingSod();
    const mrRepo = {
      findById: jest.fn().mockResolvedValue({ id: 'mr1', status: 'DRAFT', requestedBy: 'alice', projectId: null }),
      updateStatus: jest.fn().mockResolvedValue({ id: 'mr1', status: 'SUBMITTED' }),
    };
    const prisma = { $transaction: async (fn: (tx: unknown) => unknown) => fn(mrRepo) };
    const svc = new MaterialRequestService(
      { getClient: () => prisma } as never,
      mrRepo as never,
      {} as never,
      {} as never,
      { assertMember: jest.fn() } as never,
      { record: jest.fn() } as never,
      sod as never,
    );

    await svc.submit(identity('alice'), 'mr1');
    expect(sod.assertAllowed).not.toHaveBeenCalled();
  });
});
