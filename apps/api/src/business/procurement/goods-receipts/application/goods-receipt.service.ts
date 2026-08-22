import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';
import type { QualityStatus } from '@prisma/client';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { GoodsReceiptRepository } from '../infrastructure/goods-receipt.repository.js';
import { PurchaseOrderRepository } from '../../purchase-orders/infrastructure/purchase-order.repository.js';
import { CommitmentLedgerWriter } from '../../commitment-ledger/application/commitment-ledger-writer.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';

// Platform fallback when no OverReceiptPolicy is seeded for the org yet.
// Seed an OverReceiptPolicy record to override this per ADR-007, Decision 11.
const PLATFORM_FALLBACK_OVER_RECEIPT_PERCENT = new Decimal('5');

export interface CreateGrnLineDto {
  purchaseOrderLineId: string;
  receivedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity?: number;
  rejectionReason?: string;
  qualityStatus: QualityStatus;
  notes?: string;
}

export interface CreateGoodsReceiptDto {
  purchaseOrderId: string;
  deliveryDate: string;
  deliveryNoteRef?: string;
  lines: CreateGrnLineDto[];
}

@Injectable()
export class GoodsReceiptService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: GoodsReceiptRepository,
    private readonly poRepo: PurchaseOrderRepository,
    private readonly commitmentWriter: CommitmentLedgerWriter,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly sod: SegregationOfDutiesService,
  ) {}

  findAll(identity: RequestIdentity, filters?: { purchaseOrderId?: string }) {
    const prisma = this.tenancy.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, filters);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const grn = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!grn) throw new NotFoundException(`Goods receipt ${id} not found`);
    return grn;
  }

  async create(identity: RequestIdentity, dto: CreateGoodsReceiptDto) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const po = await this.poRepo.findById(prisma, orgId, dto.purchaseOrderId);
    if (!po) throw new NotFoundException(`Purchase order ${dto.purchaseOrderId} not found`);
    if (po.status !== 'OPEN') throw new ConflictException('Can only receive against an OPEN purchase order');

    // ADR-022 CONST-DOA-003: a PO creator cannot receive goods against their own order. The
    // Procurement Officer's Store-Keeper access (CONST-DOA-002) does not exempt this — access is
    // not authority. The one sanctioned override (supervisor + CFO, CONST-DOA-004) is not yet built.
    await this.sod.assertAllowed({
      organizationId: orgId,
      action: 'RECEIVE_GOODS',
      actorUserId: identity.userId,
      purchaseOrderCreatorUserId: po.createdBy,
    });

    const activeRevision = po.revisions.find(r => r.status === 'ACTIVE');
    if (!activeRevision) throw new ConflictException('Purchase order has no ACTIVE revision to receive against');

    if (!dto.lines || dto.lines.length === 0) throw new BadRequestException('At least one GRN line is required');

    const resolvedLines = await Promise.all(
      dto.lines.map(async (line, i) => {
        const poLine = activeRevision.lines.find(l => l.id === line.purchaseOrderLineId);
        if (!poLine) throw new NotFoundException(`Line ${i + 1}: PO line ${line.purchaseOrderLineId} not found in active revision`);

        const prevReceived = await this.repo.previouslyReceived(prisma, poLine.id);
        const previouslyReceivedQty = prevReceived ?? new Decimal(0);
        const totalAfter = previouslyReceivedQty.add(new Decimal(line.receivedQuantity));
        const orderedQty = poLine.orderedQuantity as Decimal;

        // Over-receipt check — reads OverReceiptPolicy (ADR-007, Decision 11; Rule OVREC-001)
        const resolvedPercent = await this.repo.resolveOverReceiptPercent(
          prisma,
          orgId,
          dto.purchaseOrderId,
          poLine.spendCategoryId ?? undefined,
        );
        const tolerancePercent = resolvedPercent ?? PLATFORM_FALLBACK_OVER_RECEIPT_PERCENT;

        const overagePercent = orderedQty.greaterThan(0)
          ? totalAfter.sub(orderedQty).div(orderedQty).mul(100)
          : new Decimal(0);

        let status: 'DRAFT' | 'EXCEPTION_PENDING' = 'DRAFT';
        if (overagePercent.greaterThan(tolerancePercent)) {
          status = 'EXCEPTION_PENDING';
        }

        const accepted = new Decimal(line.acceptedQuantity);
        const rejected = new Decimal(line.rejectedQuantity ?? 0);

        if (!accepted.add(rejected).equals(new Decimal(line.receivedQuantity))) {
          throw new BadRequestException(`Line ${i + 1}: acceptedQuantity + rejectedQuantity must equal receivedQuantity`);
        }

        return {
          line,
          poLine,
          previouslyReceivedQty,
          accepted,
          rejected,
          overReceiptStatus: status,
        };
      }),
    );

    const hasException = resolvedLines.some(r => r.overReceiptStatus === 'EXCEPTION_PENDING');
    const grnStatus = hasException ? 'EXCEPTION_PENDING' : 'DRAFT';

    const count = await this.repo.countGrnNumbers(prisma, orgId);
    const grnNumber = `GRN-${String(count + 1).padStart(5, '0')}`;

    const grnId = await prisma.$transaction(async (tx) => {
      const grn = await this.repo.create(tx, {
        organizationId: orgId,
        grnNumber,
        purchaseOrderId: po.id,
        purchaseOrderRevisionId: activeRevision.id,
        supplierId: po.supplierId,
        status: grnStatus,
        deliveryDate: new Date(dto.deliveryDate),
        deliveryNoteRef: dto.deliveryNoteRef,
        createdBy: identity.userId,
        lines: resolvedLines.map(r => ({
          purchaseOrderLineId: r.poLine.id,
          lineNumber: resolvedLines.indexOf(r) + 1,
          lineType: r.poLine.lineType,
          materialId: r.poLine.materialId ?? undefined,
          unitOfMeasureId: r.poLine.unitOfMeasureId,
          spendCategoryId: r.poLine.spendCategoryId ?? undefined,
          orderedQuantity: r.poLine.orderedQuantity as Decimal,
          previouslyReceivedQty: r.previouslyReceivedQty,
          receivedQuantity: new Decimal(r.line.receivedQuantity),
          acceptedQuantity: r.accepted,
          rejectedQuantity: r.rejected,
          rejectionReason: r.line.rejectionReason,
          qualityStatus: r.line.qualityStatus,
          notes: r.line.notes,
        })),
      });

      // Pre-populate GRN line allocations from PO allocation ratios
      for (const grnLine of grn!.lines) {
        const poAllocations = await this.repo.findPoLineAllocations(tx, grnLine.purchaseOrderLineId);
        if (!poAllocations.length) continue;

        const totalAllocated = poAllocations.reduce(
          (sum, a) => sum.add(a.allocatedQuantity as Decimal),
          new Decimal(0),
        );

        for (const alloc of poAllocations) {
          const ratio = (alloc.allocatedQuantity as Decimal).div(totalAllocated);
          const allocReceived = (grnLine.receivedQuantity as Decimal).mul(ratio);
          const allocAccepted = (grnLine.acceptedQuantity as Decimal).mul(ratio);
          const allocRejected = (grnLine.rejectedQuantity as Decimal).mul(ratio);

          await this.repo.createLineAllocation(tx, {
            organizationId: orgId,
            goodsReceiptLineId: grnLine.id,
            purchaseOrderLineRequestAllocationId: alloc.id,
            receivedQuantity: allocReceived,
            acceptedQuantity: allocAccepted,
            rejectedQuantity: allocRejected,
          });
        }
      }

      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'GoodsReceiptNote',
        resourceId: grn!.id,
        sourceCommand: 'grn.create',
        eventType: 'GRN_CREATED',
        idempotencyKey: `grn-create-${grn!.id}`,
        after: {
          grnNumber,
          purchaseOrderId: dto.purchaseOrderId,
          status: grnStatus,
        },
      });

      return grn!.id;
    });

    return this.repo.findById(prisma, orgId, grnId);
  }

  async post(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const grn = await this.repo.findById(prisma, orgId, id);
    if (!grn) throw new NotFoundException(`Goods receipt ${id} not found`);
    if (grn.status !== 'DRAFT') throw new ConflictException(`GRN is ${grn.status} — only DRAFT GRNs can be posted`);

    const po = await this.poRepo.findById(prisma, orgId, grn.purchaseOrderId);
    const activeRev = po?.revisions.find(r => r.status === 'ACTIVE');
    if (!activeRev) throw new ConflictException('Associated PO has no ACTIVE revision');

    await prisma.$transaction(async (tx) => {
      // For each accepted line: record COMMITTED -X and ACCRUED +X (ADR-007, Rule CL-002)
      for (const line of grn.lines) {
        const poLine = activeRev.lines.find(l => l.id === line.purchaseOrderLineId);
        if (!poLine) continue;

        const unitPrice = poLine.unitPrice as Decimal;
        const acceptedQty = line.acceptedQuantity as Decimal;

        if (acceptedQty.lessThanOrEqualTo(0)) continue;

        const accrualAmount = acceptedQty.mul(unitPrice);

        // COMMITTED reduction
        await this.commitmentWriter.committed(tx, {
          organizationId: orgId,
          supplierId: grn.supplierId,
          purchaseOrderId: grn.purchaseOrderId,
          spendCategoryId: line.spendCategoryId ?? undefined,
          amount: accrualAmount.negated(),
          currencyCode: activeRev.currencyCode,
          sourceDocumentType: 'GOODS_RECEIPT',
          sourceDocumentId: grn.id,
          sourceLineId: line.id,
          eventType: 'GRN_POSTED_COMMITTED_REDUCTION',
          idempotencyKey: `grn-committed-${grn.id}-${line.id}`,
          accountingDate: new Date(grn.deliveryDate),
        });

        // ACCRUED increase
        await this.commitmentWriter.accrued(tx, {
          organizationId: orgId,
          supplierId: grn.supplierId,
          purchaseOrderId: grn.purchaseOrderId,
          spendCategoryId: line.spendCategoryId ?? undefined,
          amount: accrualAmount,
          currencyCode: activeRev.currencyCode,
          sourceDocumentType: 'GOODS_RECEIPT',
          sourceDocumentId: grn.id,
          sourceLineId: line.id,
          eventType: 'GRN_POSTED_ACCRUED',
          idempotencyKey: `grn-accrued-${grn.id}-${line.id}`,
          accountingDate: new Date(grn.deliveryDate),
        });
      }

      await this.repo.updateStatus(tx, id, 'POSTED', {
        postedAt: new Date(),
        postedBy: identity.userId,
      });

      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'POST',
        resourceType: 'GoodsReceiptNote',
        resourceId: id,
        sourceCommand: 'grn.post',
        eventType: 'GRN_POSTED',
        idempotencyKey: `grn-post-${id}`,
        before: { status: 'DRAFT' },
        after: { status: 'POSTED' },
      });
    });

    return this.repo.findById(prisma, orgId, id);
  }

  async cancel(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const grn = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!grn) throw new NotFoundException(`Goods receipt ${id} not found`);
    if (grn.status === 'POSTED') throw new ConflictException('Cannot cancel a POSTED goods receipt');
    const fromStatus = grn.status;

    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.updateStatus(tx, id, 'CANCELLED');

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CANCEL',
        resourceType: 'GoodsReceiptNote',
        resourceId: id,
        sourceCommand: 'grn.cancel',
        eventType: 'GRN_CANCELLED',
        idempotencyKey: `grn-cancel-${id}-${fromStatus}`,
        before: { status: fromStatus },
        after: { status: 'CANCELLED' },
      });

      return updated;
    });
  }

  // P10: supervisor approves over-receipt exception — EXCEPTION_PENDING → DRAFT so GRN can be posted
  async approveException(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const grn = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!grn) throw new NotFoundException(`Goods receipt ${id} not found`);
    if (grn.status !== 'EXCEPTION_PENDING') {
      throw new ConflictException(`GRN is ${grn.status} — only EXCEPTION_PENDING GRNs can have their exception approved`);
    }

    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.updateStatus(tx, id, 'DRAFT', {
        exceptionReason: `Exception approved by ${identity.userId}`,
      });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'APPROVE_EXCEPTION',
        resourceType: 'GoodsReceiptNote',
        resourceId: id,
        sourceCommand: 'grn.approve-exception',
        eventType: 'GRN_EXCEPTION_APPROVED',
        idempotencyKey: `grn-approve-exception-${id}`,
        before: { status: 'EXCEPTION_PENDING' },
        after: { status: 'DRAFT' },
      });

      return updated;
    });
  }
}
