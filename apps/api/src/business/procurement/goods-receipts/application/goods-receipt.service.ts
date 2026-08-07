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
import { CommitmentLedgerRepository } from '../../commitment-ledger/infrastructure/commitment-ledger.repository.js';

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
    private readonly commitmentRepo: CommitmentLedgerRepository,
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
          (poLine as any).spendCategoryId ?? undefined,
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

    const grn = await this.repo.create(prisma, {
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
        spendCategoryId: (r.poLine as any).spendCategoryId ?? undefined,
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
      const poAllocations = await this.repo.findPoLineAllocations(prisma, grnLine.purchaseOrderLineId);
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

        await this.repo.createLineAllocation(prisma, {
          organizationId: orgId,
          goodsReceiptLineId: grnLine.id,
          purchaseOrderLineRequestAllocationId: alloc.id,
          receivedQuantity: allocReceived,
          acceptedQuantity: allocAccepted,
          rejectedQuantity: allocRejected,
        });
      }
    }

    return this.repo.findById(prisma, orgId, grn!.id);
  }

  async post(identity: RequestIdentity, id: string, dto: { exchangeRate: number; reportingCurrencyCode: string }) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const grn = await this.repo.findById(prisma, orgId, id);
    if (!grn) throw new NotFoundException(`Goods receipt ${id} not found`);
    if (grn.status !== 'DRAFT') throw new ConflictException(`GRN is ${grn.status} — only DRAFT GRNs can be posted`);

    const po = await this.poRepo.findById(prisma, orgId, grn.purchaseOrderId);
    const activeRev = po?.revisions.find(r => r.status === 'ACTIVE');
    if (!activeRev) throw new ConflictException('Associated PO has no ACTIVE revision');

    const rate = new Decimal(dto.exchangeRate);

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
        await this.commitmentRepo.create(tx as any, {
          organizationId: orgId,
          supplierId: grn.supplierId,
          purchaseOrderId: grn.purchaseOrderId,
          spendCategoryId: (line as any).spendCategoryId ?? undefined,
          stage: 'COMMITTED',
          amount: accrualAmount.negated(),
          currencyCode: activeRev.currencyCode,
          reportingAmount: accrualAmount.negated().mul(rate),
          exchangeRateSnapshot: rate,
          sourceDocumentType: 'GOODS_RECEIPT',
          sourceDocumentId: grn.id,
          sourceLineId: line.id,
          eventType: 'GRN_POSTED_COMMITTED_REDUCTION',
          idempotencyKey: `grn-committed-${grn.id}-${line.id}`,
          occurredAt: new Date(),
          accountingDate: new Date(grn.deliveryDate),
        });

        // ACCRUED increase
        await this.commitmentRepo.create(tx as any, {
          organizationId: orgId,
          supplierId: grn.supplierId,
          purchaseOrderId: grn.purchaseOrderId,
          spendCategoryId: (line as any).spendCategoryId ?? undefined,
          stage: 'ACCRUED',
          amount: accrualAmount,
          currencyCode: activeRev.currencyCode,
          reportingAmount: accrualAmount.mul(rate),
          exchangeRateSnapshot: rate,
          sourceDocumentType: 'GOODS_RECEIPT',
          sourceDocumentId: grn.id,
          sourceLineId: line.id,
          eventType: 'GRN_POSTED_ACCRUED',
          idempotencyKey: `grn-accrued-${grn.id}-${line.id}`,
          occurredAt: new Date(),
          accountingDate: new Date(grn.deliveryDate),
        });
      }

      await this.repo.updateStatus(tx as any, id, 'POSTED', {
        postedAt: new Date(),
        postedBy: identity.userId,
      });
    });

    return this.repo.findById(prisma, orgId, id);
  }

  async cancel(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const grn = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!grn) throw new NotFoundException(`Goods receipt ${id} not found`);
    if (grn.status === 'POSTED') throw new ConflictException('Cannot cancel a POSTED goods receipt');
    return this.repo.updateStatus(prisma, id, 'CANCELLED');
  }
}
