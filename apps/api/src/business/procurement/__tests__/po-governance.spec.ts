/**
 * PO confirm governance gate (ADR-011 seam, ADR-015 re-drive, ADR-022 CONST-DOA-005).
 *
 * Real DB, real CommandGovernanceService. The value-band binding is the seeded shape:
 * entityType 'PurchaseOrder', DRAFT → SUBMITTED, transactionType PURCHASE_ORDER.
 */
import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { WorkflowTransactionType } from '@erp/types';
import { ProcurementFixtureFactory, type ProcurementTestEnv } from './helpers/procurement-fixture.factory.js';
import { buildProcurementServices, type ProcurementServices } from './helpers/build-procurement-services.js';

const prisma = new PrismaClient();
let env: ProcurementTestEnv;
let svc: ProcurementServices;
const APPROVER = 'po-gov-approver';

async function draftPo(qty = 10, price = 100) {
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
        orderedQuantity: qty,
        unitPrice: price,
        spendCategoryId: env.spendCategoryId,
      },
    ],
  });
  return po!;
}

async function confirmExpecting409(poId: string): Promise<string> {
  let id: string | undefined;
  await expect(
    svc.poService.confirm(env.identity, poId).catch((e: unknown) => {
      id = (e as { response?: { details?: { approvalInstanceId?: string } } }).response?.details
        ?.approvalInstanceId;
      throw e;
    }),
  ).rejects.toBeInstanceOf(ConflictException);
  expect(id).toBeTruthy();
  return id!;
}

async function committedCount(poId: string) {
  return prisma.commitmentLedgerEntry.count({
    where: { organizationId: env.orgId, purchaseOrderId: poId, stage: 'COMMITTED' },
  });
}

beforeAll(async () => {
  env = await ProcurementFixtureFactory.create(prisma);
  svc = buildProcurementServices(prisma);
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM approval_actions WHERE instance_id IN (SELECT ai.id FROM approval_instances ai JOIN workflow_definitions wd ON ai.workflow_definition_id = wd.id WHERE wd.organization_id = ${env.orgId})`;
  await prisma.$executeRaw`DELETE FROM approval_instances WHERE workflow_definition_id IN (SELECT id FROM workflow_definitions WHERE organization_id = ${env.orgId})`;
  await prisma.$executeRaw`DELETE FROM workflow_trigger_bindings WHERE organization_id = ${env.orgId}`;
  await prisma.$executeRaw`DELETE FROM workflow_definitions WHERE organization_id = ${env.orgId}`;
  await ProcurementFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

describe('PO confirm — governance gate', () => {
  it('no binding → confirms directly; approvedBy is the confirmer, no approval instance', async () => {
    const po = await draftPo();
    await svc.poService.confirm(env.identity, po.id);

    const rev = await prisma.purchaseOrderRevision.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
    expect(rev.status).toBe('ACTIVE');
    expect(rev.approvedBy).toBe(env.identity.userId);
    expect(rev.approvalInstanceId).toBeNull();
    expect(await committedCount(po.id)).toBe(1);
  });

  describe('with an active PurchaseOrder DRAFT→SUBMITTED binding', () => {
    beforeAll(async () => {
      const def = await prisma.workflowDefinition.create({
        data: {
          organizationId: env.orgId,
          transactionType: WorkflowTransactionType.PURCHASE_ORDER,
          name: `PO gate ${env.orgId}`,
          isActive: true,
          requiresCeoConfirmation: false,
          steps: { create: [{ stepOrder: 1, roleRequired: 'Procurement Manager', isOptional: false, notifyRoles: [] }] },
        },
      });
      await prisma.workflowTriggerBinding.create({
        data: {
          organizationId: env.orgId,
          triggerKind: 'STATE_TRANSITION',
          entityType: 'PurchaseOrder',
          transactionType: WorkflowTransactionType.PURCHASE_ORDER,
          fromState: 'DRAFT',
          toState: 'SUBMITTED',
          workflowDefinitionId: def.id,
          priority: 50,
          isActive: true,
        },
      });
    });

    it('gates: 409 with approvalInstanceId, nothing written; repeat returns the same pending id; approved → re-drive confirms once', async () => {
      const po = await draftPo(10, 250);

      const firstId = await confirmExpecting409(po.id);
      const instance = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: firstId } });
      expect(instance.status).toBe('PENDING');
      expect(instance.transactionId).toBe(po.id);
      expect(instance.evaluatedAmount?.toString()).toBe('2500');

      // Nothing written.
      const stillDraft = await prisma.purchaseOrder.findUniqueOrThrow({
        where: { id: po.id },
        include: { revisions: true },
      });
      expect(stillDraft.status).toBe('DRAFT');
      expect(stillDraft.revisions[0].status).toBe('DRAFT');
      expect(await committedCount(po.id)).toBe(0);

      // Pending → the same instance id, no duplicate.
      expect(await confirmExpecting409(po.id)).toBe(firstId);
      expect(await prisma.approvalInstance.count({ where: { transactionId: po.id } })).toBe(1);

      // A distinct approver completes the chain.
      await prisma.approvalAction.create({
        data: { instanceId: firstId, stepOrder: 1, action: 'APPROVE', actorId: APPROVER },
      });
      await prisma.approvalInstance.update({ where: { id: firstId }, data: { status: 'APPROVED' } });

      // Re-drive: consumes the approval and confirms.
      await svc.poService.confirm(env.identity, po.id);
      const rev = await prisma.purchaseOrderRevision.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
      expect(rev.status).toBe('ACTIVE');
      expect(rev.approvalInstanceId).toBe(firstId);
      expect(rev.approvedBy).toBe(APPROVER);
      expect(await committedCount(po.id)).toBe(1);
      const consumed = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: firstId } });
      expect(consumed.status).toBe('CANCELLED');

      // A second confirm has no draft to confirm and writes nothing more.
      await expect(svc.poService.confirm(env.identity, po.id)).rejects.toBeInstanceOf(ConflictException);
      expect(await committedCount(po.id)).toBe(1);
    });

    it('cancelling a PO closes its pending approval', async () => {
      const po = await draftPo();
      const id = await confirmExpecting409(po.id);
      await svc.poService.cancel(env.identity, po.id);
      const inst = await prisma.approvalInstance.findUniqueOrThrow({ where: { id } });
      expect(inst.status).toBe('CANCELLED');
    });
  });
});
