/**
 * Procurement list read models (PO / MR / GRN / suppliers / catalogue / buyer advances /
 * commitment entries). Real DB. Money fields are gated on view:commitment-ledger.
 */
import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';
import type { TenancyService } from '../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../platform/project-access/project-access.service.js';
import { ProcurementFixtureFactory, type ProcurementTestEnv } from './helpers/procurement-fixture.factory.js';
import { buildProcurementServices, type ProcurementServices } from './helpers/build-procurement-services.js';
import { PurchaseOrderListService } from '../purchase-orders/application/purchase-order-list.service.js';
import { PurchaseOrderListRepository } from '../purchase-orders/infrastructure/purchase-order-list.repository.js';
import { GoodsReceiptListService } from '../goods-receipts/application/goods-receipt-list.service.js';
import { GoodsReceiptListRepository } from '../goods-receipts/infrastructure/goods-receipt-list.repository.js';
import { SupplierDirectoryService } from '../supplier-directory/application/supplier-directory.service.js';
import { SupplierDirectoryRepository } from '../supplier-directory/infrastructure/supplier-directory.repository.js';
import { SupplierService } from '../../accounting/accounts-payable/application/supplier.service.js';
import { SupplierRepository } from '../../accounting/accounts-payable/infrastructure/supplier.repository.js';
import { BuyerAdvanceService } from '../../accounting/accounts-payable/application/buyer-advance.service.js';
import { BuyerAdvanceRepository } from '../../accounting/accounts-payable/infrastructure/buyer-advance.repository.js';
import { CommitmentLedgerService } from '../commitment-ledger/application/commitment-ledger.service.js';
import { CommitmentLedgerRepository } from '../commitment-ledger/infrastructure/commitment-ledger.repository.js';
import { CommitmentEntryLabelsRepository } from '../commitment-ledger/infrastructure/commitment-entry-labels.repository.js';
import { UomService } from '../catalogue/application/uom.service.js';
import { UomRepository } from '../catalogue/infrastructure/uom.repository.js';
import { MaterialCategoryService } from '../catalogue/application/material-category.service.js';
import { MaterialCategoryRepository } from '../catalogue/infrastructure/material-category.repository.js';
import { SpendCategoryService } from '../catalogue/application/spend-category.service.js';
import { SpendCategoryRepository } from '../catalogue/infrastructure/spend-category.repository.js';

const prisma = new PrismaClient();
let env: ProcurementTestEnv;
let svc: ProcurementServices;
let money: RequestIdentity;
let blind: RequestIdentity;
const tenancy = { getClient: () => prisma } as unknown as TenancyService;
const audits: Array<{ eventType: string; resourceId: string }> = [];
const audit = {
  record: async (_tx: unknown, cmd: { eventType: string; resourceId: string }) => {
    audits.push({ eventType: cmd.eventType, resourceId: cmd.resourceId });
  },
} as never;

let poList: PurchaseOrderListService;
let grnList: GoodsReceiptListService;
let suppliers: SupplierDirectoryService;
let poId: string;
let poNumber: string;
let poLineId: string;

beforeAll(async () => {
  env = await ProcurementFixtureFactory.create(prisma);
  svc = buildProcurementServices(prisma);
  money = { ...env.identity, permissions: [PERMISSIONS.procurementView, PERMISSIONS.commitmentsView] };
  blind = { ...env.identity, permissions: [PERMISSIONS.procurementView] };
  const access = new ProjectAccessService(tenancy);
  poList = new PurchaseOrderListService(tenancy, new PurchaseOrderListRepository(), access);
  grnList = new GoodsReceiptListService(tenancy, new GoodsReceiptListRepository(), access);
  suppliers = new SupplierDirectoryService(tenancy, new SupplierDirectoryRepository());

  // One confirmed project PO: 10 t @ 250 on the fixture project, then 4 t received.
  const po = await svc.poService.create(env.identity, {
    supplierId: env.supplierId,
    currencyCode: 'USD',
    effectiveFrom: '2026-08-15',
    lines: [
      {
        lineType: 'MATERIAL',
        materialCode: 'REBAR-12',
        description: '12mm Rebar',
        uomCode: 'TON',
        orderedQuantity: 10,
        unitPrice: 250,
        projectId: env.projectId,
        boqNodeId: env.boqNodeId,
      },
    ],
  });
  await svc.poService.confirm(env.identity, po!.id);
  const full = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: po!.id },
    include: { revisions: { include: { lines: true } } },
  });
  poId = full.id;
  poNumber = full.poNumber;
  poLineId = full.revisions[0].lines[0].id;
  const grn = await svc.grnService.create(env.identity, {
    purchaseOrderId: poId,
    deliveryDate: '2026-08-20',
    deliveryNoteRef: 'DN-777',
    lines: [{ purchaseOrderLineId: poLineId, receivedQuantity: 4, acceptedQuantity: 4, qualityStatus: 'ACCEPTED' }],
  });
  await svc.grnService.post(env.identity, grn!.id);

  // A draft org-level PO (no project).
  await svc.poService.create(env.identity, {
    supplierId: env.supplierId,
    currencyCode: 'USD',
    effectiveFrom: '2026-08-15',
    lines: [{ lineType: 'SERVICE', description: 'Office cleaning', uomCode: 'TON', orderedQuantity: 1, unitPrice: 80 }],
  });
});

afterAll(async () => {
  await ProcurementFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

describe('PO list', () => {
  it('adds project, total, delivery status and revision facts; keeps the old shape', async () => {
    const rows = await poList.list(money, {});
    const row = rows.find((r) => r.id === poId)!;
    expect(row).toMatchObject({
      poNumber,
      supplier: { id: env.supplierId },
      project: { id: env.projectId, code: 'PRJ-001', name: 'Test Site' },
      projectCount: 1,
      total: '2500.00',
      currencyCode: 'USD',
      deliveryStatus: 'PARTLY_RECEIVED',
      activeRevisionNumber: 1,
      revisionStatus: 'ACTIVE',
      moneyVisible: true,
    });
    expect(row.revisions).toHaveLength(1);
    expect((row.revisions[0] as Record<string, unknown>).lines).toBeUndefined();

    const draft = rows.find((r) => r.id !== poId)!;
    expect(draft).toMatchObject({ project: null, projectCount: 0, total: '80.00', deliveryStatus: null, activeRevisionNumber: null, revisionStatus: 'DRAFT' });
  });

  it('hides money without view:commitment-ledger', async () => {
    const row = (await poList.list(blind, {})).find((r) => r.id === poId)!;
    expect(row.total).toBeNull();
    expect(row.moneyVisible).toBe(false);
  });

  it('filters by search (PO number / supplier name), project and status', async () => {
    expect((await poList.list(money, { search: poNumber })).map((r) => r.id)).toEqual([poId]);
    expect((await poList.list(money, { search: 'steel co' })).length).toBe(2);
    expect((await poList.list(money, { search: 'nothing-matches' })).length).toBe(0);
    expect((await poList.list(money, { projectId: env.projectId })).map((r) => r.id)).toEqual([poId]);
    expect((await poList.list(money, { status: 'DRAFT' })).every((r) => r.status === 'DRAFT')).toBe(true);
  });

  it('scopes project POs to project members; org-level POs stay visible', async () => {
    const outsider = { ...money, userId: `${env.orgId}-nobody`, roles: ['Site Engineer'] };
    const ids = (await poList.list(outsider, {})).map((r) => r.id);
    expect(ids).not.toContain(poId);
    expect(ids.length).toBe(1);
  });
});

describe('MR list', () => {
  let projectMrId: string;
  let overheadMrId: string;
  beforeAll(async () => {
    projectMrId = (
      await svc.mrService.create(env.identity, {
        requestScope: 'PROJECT',
        projectId: env.projectId,
        title: 'Rebar for slab',
        currencyCode: 'USD',
        lines: [
          { lineType: 'MATERIAL', materialCode: 'REBAR-12', description: 'x', uomCode: 'TON', requestedQuantity: 3, estimatedUnitPrice: 200 },
          { lineType: 'MATERIAL', materialCode: 'REBAR-12', description: 'y', uomCode: 'TON', requestedQuantity: 1 },
        ],
      })
    ).id;
    overheadMrId = (
      await svc.mrService.create(env.identity, {
        requestScope: 'ORGANIZATION',
        title: 'Office paper',
        lines: [{ lineType: 'MATERIAL', materialCode: 'REBAR-12', description: 'z', uomCode: 'TON', requestedQuantity: 1 }],
      })
    ).id;
  });

  it('adds estimatedTotal (priced lines only), requester and project; money gated', async () => {
    const rows = await svc.mrService.findAll(money, {});
    expect(rows.find((r) => r.id === projectMrId)).toMatchObject({
      estimatedTotal: '600.00',
      requester: { id: env.identity.userId, name: 'Procurement Tester' },
      project: { id: env.projectId, code: 'PRJ-001', name: 'Test Site' },
      moneyVisible: true,
    });
    expect(rows.find((r) => r.id === overheadMrId)).toMatchObject({ estimatedTotal: null, project: null });
    const hidden = (await svc.mrService.findAll(blind, {})).find((r) => r.id === projectMrId)!;
    expect(hidden.estimatedTotal).toBeNull();
  });

  it("filters requestedFor = projectId | 'overhead', and searches number / title / project", async () => {
    expect((await svc.mrService.findAll(money, { requestedFor: 'overhead' })).map((r) => r.id)).toEqual([overheadMrId]);
    expect((await svc.mrService.findAll(money, { requestedFor: env.projectId })).map((r) => r.id)).toEqual([projectMrId]);
    expect((await svc.mrService.findAll(money, { search: 'slab' })).map((r) => r.id)).toEqual([projectMrId]);
    expect((await svc.mrService.findAll(money, { search: 'test site' })).map((r) => r.id)).toEqual([projectMrId]);
    // The older scope param still works.
    expect((await svc.mrService.findAll(money, { scope: 'ORGANIZATION' })).map((r) => r.id)).toEqual([overheadMrId]);
  });
});

describe('GRN list', () => {
  it('adds supplier, PO, project and deliveredBy; filters status / PO / search', async () => {
    const rows = await grnList.list(money, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      supplier: { id: env.supplierId, name: 'Test Steel Co.' },
      purchaseOrder: { id: poId, number: poNumber },
      project: { id: env.projectId, name: 'Test Site' },
      deliveredBy: { id: env.identity.userId, name: 'Procurement Tester' },
    });
    expect(rows[0].lines[0]).not.toHaveProperty('poLine');
    expect(await grnList.list(money, { status: 'DRAFT' })).toHaveLength(0);
    expect(await grnList.list(money, { search: 'DN-777' })).toHaveLength(1);
    expect(await grnList.list(money, { search: poNumber })).toHaveLength(1);
    expect(await grnList.list(money, { purchaseOrderId: 'none' })).toHaveLength(0);
  });
});

describe('Supplier directory + status', () => {
  beforeAll(async () => {
    await prisma.supplierContact.create({
      data: { supplierId: env.supplierId, name: 'Ali', phone: '+252 61 000', isPrimary: true },
    });
    await prisma.supplierBill.create({
      data: {
        organizationId: env.orgId,
        supplierId: env.supplierId,
        supplierInvoiceNumber: 'INV-1',
        supplierInvoiceNumberNorm: 'INV1',
        billDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-25'),
        currencyCode: 'USD',
        subtotal: new Decimal(300),
        vatAmount: new Decimal(0),
        totalAmount: new Decimal(300),
        outstandingAmount: new Decimal(120),
        postingStatus: 'POSTED',
        createdBy: env.identity.userId,
      },
    });
  });

  it('lists contact, terms, open PO count and payable balance (money gated)', async () => {
    const [row] = await suppliers.list(money, {});
    expect(row).toMatchObject({
      code: 'SUP-001',
      status: 'ACTIVE',
      primaryContact: { name: 'Ali', phone: '+252 61 000' },
      openOrderCount: 1,
      payableBalance: '120.00',
      payableBalances: [{ currencyCode: 'USD', amount: '120.00' }],
      moneyVisible: true,
    });
    const [hidden] = await suppliers.list(blind, {});
    expect(hidden).toMatchObject({ payableBalance: null, payableBalances: null, moneyVisible: false, openOrderCount: 1 });
  });

  it('deactivate / reactivate are audited and guarded; the status filter follows', async () => {
    const supplierSvc = new SupplierService(tenancy, new SupplierRepository(), audit);
    await supplierSvc.deactivate(env.identity, env.supplierId);
    await expect(supplierSvc.deactivate(env.identity, env.supplierId)).rejects.toBeInstanceOf(ConflictException);
    expect(await suppliers.list(money, { status: 'ACTIVE' })).toHaveLength(0);
    expect(await suppliers.list(money, { status: 'INACTIVE' })).toHaveLength(1);
    await supplierSvc.reactivate(env.identity, env.supplierId);
    expect(audits.filter((a) => a.resourceId === env.supplierId).map((a) => a.eventType)).toEqual([
      'SUPPLIER_DEACTIVATED',
      'SUPPLIER_REACTIVATED',
    ]);
  });
});

describe('Catalogue status filter + reactivate', () => {
  it('UoM / categories / materials: default ACTIVE, INACTIVE and ALL, reactivate audited', async () => {
    const uom = new UomService(tenancy, new UomRepository(), audit);
    const extra = await uom.create(env.identity, { code: 'BAG', name: 'Bag', symbol: 'bag' });
    await uom.deactivate(env.identity, extra.id);
    expect((await uom.findAll(env.identity)).map((u) => u.code)).toEqual(['TON']);
    expect((await uom.findAll(env.identity, 'INACTIVE')).map((u) => u.code)).toEqual(['BAG']);
    expect((await uom.findAll(env.identity, 'ALL')).length).toBe(2);
    await uom.reactivate(env.identity, extra.id);
    await expect(uom.reactivate(env.identity, extra.id)).rejects.toBeInstanceOf(ConflictException);
    expect((await uom.findAll(env.identity)).length).toBe(2);

    const cats = new MaterialCategoryService(tenancy, new MaterialCategoryRepository(), audit);
    await cats.deactivate(env.identity, env.materialCategoryId);
    expect(await cats.findAll(env.identity)).toHaveLength(0);
    expect((await cats.findAll(env.identity, 'INACTIVE')).map((c) => c.id)).toEqual([env.materialCategoryId]);
    await cats.reactivate(env.identity, env.materialCategoryId);
    expect(await cats.findAll(env.identity)).toHaveLength(1);

    const spend = new SpendCategoryService(tenancy, new SpendCategoryRepository(), audit);
    await spend.deactivate(env.identity, env.spendCategoryId);
    expect((await spend.findAll(env.identity, 'ALL')).map((c) => c.status)).toEqual(['INACTIVE']);
    await spend.reactivate(env.identity, env.spendCategoryId);

    await svc.materialService.discontinue(env.identity, env.materialId);
    expect(await svc.materialService.findAll(env.identity)).toHaveLength(0);
    expect((await svc.materialService.findAll(env.identity, { status: 'INACTIVE' })).map((m) => m.status)).toEqual(['DISCONTINUED']);
    await svc.materialService.reactivate(env.identity, env.materialId);
    expect(await svc.materialService.findAll(env.identity)).toHaveLength(1);

    expect(audits.map((a) => a.eventType)).toEqual(
      expect.arrayContaining(['UOM_DEACTIVATED', 'UOM_REACTIVATED', 'MATERIAL_CATEGORY_REACTIVATED', 'SPEND_CATEGORY_REACTIVATED']),
    );
  });
});

describe('Buyer advances — org-wide list', () => {
  it('lists without purchaseOrderId and carries PO number + supplier name', async () => {
    const bank = await prisma.bankAccount.create({
      data: {
        organizationId: env.orgId,
        glAccountId: env.expAccountId,
        bankName: 'B',
        accountName: 'A',
        accountNumber: `LRM-${Date.now()}`,
        currencyCode: 'USD',
        createdBy: env.identity.userId,
      },
    });
    await prisma.buyerAdvance.create({
      data: {
        organizationId: env.orgId,
        purchaseOrderId: poId,
        recipientUserId: env.identity.userId,
        amount: new Decimal(500),
        currencyCode: 'USD',
        paymentMethod: 'BANK',
        disbursementBankAccountId: bank.id,
        advancedAt: new Date('2026-08-16'),
        createdBy: env.identity.userId,
      },
    });
    const advances = new BuyerAdvanceService(tenancy, new BuyerAdvanceRepository(), {} as never);
    const all = await advances.list(env.identity, {});
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      purchaseOrder: { id: poId, poNumber },
      supplier: { id: env.supplierId, name: 'Test Steel Co.' },
    });
    expect(all[0].outstanding.toString()).toBe('500');
    expect(await advances.list(env.identity, { purchaseOrderId: poId })).toHaveLength(1);
    expect(await advances.list(env.identity, { purchaseOrderId: 'other' })).toHaveLength(0);
  });
});

describe('Commitment entries — labels', () => {
  it('carry documentNumber, supplierName and boqNode', async () => {
    const ledger = new CommitmentLedgerService(tenancy, new CommitmentLedgerRepository(), new CommitmentEntryLabelsRepository());
    const rows = await ledger.queryByProject(env.identity, env.projectId);
    const committed = rows.find((r) => r.sourceDocumentType === 'PURCHASE_ORDER_REVISION')!;
    expect(committed).toMatchObject({
      documentNumber: `${poNumber} (Rev 1)`,
      supplierName: 'Test Steel Co.',
      boqNode: { id: env.boqNodeId, code: 'BN-001', name: 'Foundation Works' },
    });
    const grnRow = rows.find((r) => r.sourceDocumentType === 'GOODS_RECEIPT')!;
    expect(grnRow.documentNumber).toMatch(/^GRN-/);
    expect((await ledger.queryByPo(env.identity, poId)).every((r) => r.supplierName === 'Test Steel Co.')).toBe(true);
  });
});
