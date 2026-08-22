import { ForbiddenException } from '@nestjs/common';

import { GoodsReceiptService } from '../goods-receipts/application/goods-receipt.service.js';
import { MaterialRequestService } from '../material-requests/application/material-request.service.js';
import { PurchaseOrderService } from '../purchase-orders/application/purchase-order.service.js';

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
  it('purchase order: the vendor maintainer creating a PO is checked as CREATE_PURCHASE_ORDER', async () => {
    const sod = denyingSod();
    const prisma = {
      supplier: { findFirst: jest.fn().mockResolvedValue({ createdBy: 'alice' }) },
    };
    const svc = new PurchaseOrderService(
      { getClient: () => prisma } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      sod as never,
    );

    await expect(
      svc.create(identity('alice'), {
        supplierId: 's1',
        currencyCode: 'USD',
        effectiveFrom: '2026-09-01',
        lines: [{ description: 'x', orderedQuantity: 1, unitPrice: 10 }] as never,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(sod.assertAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE_PURCHASE_ORDER',
        actorUserId: 'alice',
        vendorMaintainerUserId: 'alice',
      }),
    );
  });

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
      { isReceiptCleared: async () => false } as never,
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

  it('goods receipt: an APPROVED CONST-DOA-004 exception clears the PO creator (no block)', async () => {
    const sod = { assertAllowed: jest.fn() };
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
      { isReceiptCleared: async () => true } as never,
    );

    // The receiver is the PO creator, but a cleared exception means the block cannot fire — the
    // service passes no purchaseOrderCreatorUserId. (It then fails later on the empty lines list.)
    await expect(
      svc.create(identity('alice'), { purchaseOrderId: 'po1', deliveryDate: '2026-09-01', lines: [] }),
    ).rejects.not.toBeInstanceOf(ForbiddenException);

    expect(sod.assertAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RECEIVE_GOODS', purchaseOrderCreatorUserId: undefined }),
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
