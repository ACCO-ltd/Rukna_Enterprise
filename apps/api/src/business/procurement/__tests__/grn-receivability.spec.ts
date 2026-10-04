/**
 * Receivability + GRN receiving rules (ADR-022 CONST-DOA-003/004).
 * Real DB, real SegregationOfDutiesService with PO_CREATOR_CANNOT_RECEIVE_GOODS active.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';
import { REQUIRED_PERMISSIONS_KEY } from '../../../common/decorators/require-permissions.decorator.js';
import { PurchaseOrderController } from '../purchase-orders/presentation/purchase-order.controller.js';
import { ReceivabilityService } from '../purchase-orders/application/receivability.service.js';
import { ReceivabilityRepository } from '../purchase-orders/infrastructure/receivability.repository.js';
import { GoodsReceiptService } from '../goods-receipts/application/goods-receipt.service.js';
import { GoodsReceiptRepository } from '../goods-receipts/infrastructure/goods-receipt.repository.js';
import { GrnAttachmentRepository } from '../goods-receipts/infrastructure/grn-attachment.repository.js';
import { ReceiptExceptionService } from '../goods-receipts/application/receipt-exception.service.js';
import { ReceiptExceptionRepository } from '../goods-receipts/infrastructure/receipt-exception.repository.js';
import { PurchaseOrderRepository } from '../purchase-orders/infrastructure/purchase-order.repository.js';
import { SegregationOfDutiesService } from '../../../platform/workflows/application/segregation-of-duties.service.js';
import { ProjectAccessService } from '../../../platform/project-access/project-access.service.js';
import type { TenancyService } from '../../../platform/tenancy/tenancy.service.js';
import { ProcurementFixtureFactory, type ProcurementTestEnv } from './helpers/procurement-fixture.factory.js';
import { buildProcurementServices, type ProcurementServices } from './helpers/build-procurement-services.js';
import { activateSodRules, cleanupGovernance } from './helpers/governance-fixture.js';

const prisma = new PrismaClient();
let env: ProcurementTestEnv;
let base: ProcurementServices;
let grn: GoodsReceiptService;
let receivability: ReceivabilityService;
let creator: RequestIdentity;
let storekeeper: RequestIdentity;

async function confirmedPo(qty = 10) {
  const po = await base.poService.create(creator, {
    supplierId: env.supplierId,
    currencyCode: 'USD',
    effectiveFrom: '2026-08-15',
    lines: [
      {
        lineType: 'MATERIAL',
        materialCode: 'REBAR-12',
        description: '12mm Rebar',
        uomCode: 'TON',
        orderedQuantity: qty,
        unitPrice: 100,
        projectId: env.projectId,
        boqNodeId: env.boqNodeId,
      },
    ],
  });
  await base.poService.confirm(creator, po!.id);
  return prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: po!.id },
    include: { revisions: { include: { lines: true } } },
  });
}

function draftGrn(by: RequestIdentity, poId: string, poLineId: string, received: number, accepted = received, reason?: string) {
  return grn.create(by, {
    purchaseOrderId: poId,
    deliveryDate: '2026-08-20',
    lines: [
      {
        purchaseOrderLineId: poLineId,
        receivedQuantity: received,
        acceptedQuantity: accepted,
        rejectedQuantity: received - accepted,
        rejectionReason: reason,
        qualityStatus: received === accepted ? 'ACCEPTED' : 'PARTIALLY_ACCEPTED',
      },
    ],
  });
}

async function errorOf(p: Promise<unknown>) {
  return p.then(() => null, (e: unknown) => e);
}

beforeAll(async () => {
  env = await ProcurementFixtureFactory.create(prisma);
  creator = env.identity;
  const skId = `${env.orgId}-storekeeper`;
  await prisma.user.create({
    data: {
      id: skId,
      organizationId: env.orgId,
      email: `${skId}@example.test`,
      passwordHash: 'x',
      firstName: 'Store',
      lastName: 'Keeper',
      status: 'ACTIVE',
    },
  });
  storekeeper = { ...env.identity, userId: skId };
  await prisma.projectMember.create({ data: { projectId: env.projectId, userId: skId, joinedBy: skId } });
  await activateSodRules(prisma, env.orgId, ['PO_CREATOR_CANNOT_RECEIVE_GOODS']);

  base = buildProcurementServices(prisma);
  const tenancy = { getClient: () => prisma } as unknown as TenancyService;
  const sod = new SegregationOfDutiesService(tenancy);
  const poRepo = new PurchaseOrderRepository();
  grn = new GoodsReceiptService(
    tenancy,
    new GoodsReceiptRepository(),
    new GrnAttachmentRepository(),
    poRepo,
    base.poService,
    base.commitmentWriter,
    { record: async () => undefined } as never,
    sod,
    new ReceiptExceptionService(tenancy, new ReceiptExceptionRepository(), poRepo),
  );
  receivability = new ReceivabilityService(tenancy, new ReceivabilityRepository(), sod, new ProjectAccessService(tenancy));
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM po_receipt_exceptions WHERE organization_id = ${env.orgId}`;
  await cleanupGovernance(prisma, env.orgId);
  await ProcurementFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

describe('GET /procurement/purchase-orders/receivable', () => {
  it('requires procurement view AND goods-receipt create', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, PurchaseOrderController.prototype.listReceivable)).toEqual([
      PERMISSIONS.procurementView,
      PERMISSIONS.goodsReceiptsCreate,
    ]);
  });

  it('lists an OPEN PO with remaining quantity; the creator is blocked, another person is not', async () => {
    const po = await confirmedPo(10);

    const forCreator = (await receivability.listReceivable(creator)).find((r) => r.id === po.id);
    expect(forCreator).toMatchObject({
      poNumber: po.poNumber,
      status: 'OPEN',
      supplier: { id: env.supplierId },
      activeRevisionNumber: 1,
      canReceive: false,
      blockedReason: 'PO_CREATOR_CANNOT_RECEIVE_GOODS',
      receiptException: null,
      projects: [{ id: env.projectId, code: 'PRJ-001', name: 'Test Site' }],
    });
    expect(forCreator!.lines[0]).toMatchObject({ orderedQuantity: '10', acceptedQuantity: '0', remainingQuantity: '10' });
    // No prices on this read.
    expect(JSON.stringify(forCreator)).not.toMatch(/unitPrice|amount|total/i);

    const forStorekeeper = (await receivability.listReceivable(storekeeper)).find((r) => r.id === po.id);
    expect(forStorekeeper).toMatchObject({ canReceive: true, blockedReason: null });

    // Project scoping: a non-bypass caller who is not on the PO's project does not see it.
    const outsider = { ...env.identity, userId: `${env.orgId}-outsider`, roles: ['Site Engineer'] };
    expect((await receivability.listReceivable(outsider)).some((r) => r.id === po.id)).toBe(false);
  });

  it('drops a PO once everything is accepted, and shows partial remaining before that', async () => {
    const po = await confirmedPo(10);
    const lineId = po.revisions[0].lines[0].id;

    const first = await draftGrn(storekeeper, po.id, lineId, 4);
    await grn.post(storekeeper, first!.id);
    const partial = (await receivability.listReceivable(storekeeper)).find((r) => r.id === po.id);
    expect(partial!.lines[0]).toMatchObject({ acceptedQuantity: '4', remainingQuantity: '6' });

    const second = await draftGrn(storekeeper, po.id, lineId, 6);
    await grn.post(storekeeper, second!.id);
    expect((await receivability.listReceivable(storekeeper)).some((r) => r.id === po.id)).toBe(false);
  });

  it('an APPROVED receipt exception clears the creator and is reported', async () => {
    const po = await confirmedPo(5);
    const exc = await prisma.poReceiptException.create({
      data: {
        organizationId: env.orgId,
        purchaseOrderId: po.id,
        receiverUserId: creator.userId,
        reason: 'Only person on site',
        status: 'APPROVED',
        requestedBy: creator.userId,
      },
    });
    const row = (await receivability.listReceivable(creator)).find((r) => r.id === po.id);
    expect(row).toMatchObject({ canReceive: true, blockedReason: null, receiptException: { id: exc.id, status: 'APPROVED' } });
    // ...and the GRN command agrees.
    await expect(draftGrn(creator, po.id, po.revisions[0].lines[0].id, 1)).resolves.toBeTruthy();
  });
});

describe('GRN receiving rules', () => {
  it('create by the PO creator → 403 with details.code, message unchanged', async () => {
    const po = await confirmedPo(3);
    const err = await errorOf(draftGrn(creator, po.id, po.revisions[0].lines[0].id, 1));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).message).toContain('PO_CREATOR_CANNOT_RECEIVE_GOODS');
    expect((err as ForbiddenException).getResponse()).toMatchObject({ details: { code: 'PO_CREATOR_CANNOT_RECEIVE_GOODS' } });
  });

  it('post re-checks SoD: the PO creator cannot post a GRN someone else drafted', async () => {
    const po = await confirmedPo(3);
    const draft = await draftGrn(storekeeper, po.id, po.revisions[0].lines[0].id, 2);
    const err = await errorOf(grn.post(creator, draft!.id));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((await prisma.goodsReceiptNote.findUniqueOrThrow({ where: { id: draft!.id } })).status).toBe('DRAFT');
    await grn.post(storekeeper, draft!.id);
    expect((await prisma.goodsReceiptNote.findUniqueOrThrow({ where: { id: draft!.id } })).status).toBe('POSTED');
  });

  it('rejected quantity needs a rejectionReason (400); with one it is accepted', async () => {
    const po = await confirmedPo(5);
    const lineId = po.revisions[0].lines[0].id;
    await expect(draftGrn(storekeeper, po.id, lineId, 5, 3)).rejects.toBeInstanceOf(BadRequestException);
    await expect(draftGrn(storekeeper, po.id, lineId, 5, 3, '   ')).rejects.toBeInstanceOf(BadRequestException);
    const ok = await draftGrn(storekeeper, po.id, lineId, 5, 3, 'Bent bars');
    expect(ok!.lines[0].rejectionReason).toBe('Bent bars');
  });
});
