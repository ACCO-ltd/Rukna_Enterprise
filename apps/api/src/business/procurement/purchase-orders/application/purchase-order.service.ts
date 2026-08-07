import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';
import type { PurchaseOrderStatus, ProcurementLineType } from '@prisma/client';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { PurchaseOrderRepository } from '../infrastructure/purchase-order.repository.js';
import { MaterialRepository } from '../../catalogue/infrastructure/material.repository.js';
import { UomRepository } from '../../catalogue/infrastructure/uom.repository.js';
import { CommitmentLedgerRepository } from '../../commitment-ledger/infrastructure/commitment-ledger.repository.js';

export interface CreatePoLineDto {
  lineType: ProcurementLineType;
  materialCode?: string;
  description: string;
  uomCode: string;
  orderedQuantity: number;
  unitPrice: number;
  spendCategoryId?: string;
  taxCodeId?: string;
  notes?: string;
  mrLineAllocations?: Array<{ materialRequestLineId: string; allocatedQuantity: number }>;
}

export interface CreatePurchaseOrderDto {
  supplierId: string;
  currencyCode: string;
  effectiveFrom: string;
  reason?: string;
  deliveryAddress?: string;
  expectedDeliveryDate?: string;
  lines: CreatePoLineDto[];
}

export interface RevisePoDto {
  reason: string;
  currencyCode: string;
  effectiveFrom: string;
  deliveryAddress?: string;
  expectedDeliveryDate?: string;
  lines: CreatePoLineDto[];
}

export interface ApprovePurchaseOrderDto {
  reportingCurrencyCode: string;
  exchangeRate: number;
}

@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: PurchaseOrderRepository,
    private readonly materialRepo: MaterialRepository,
    private readonly uomRepo: UomRepository,
    private readonly commitmentRepo: CommitmentLedgerRepository,
  ) {}

  findAll(identity: RequestIdentity, filters?: { status?: PurchaseOrderStatus; supplierId?: string }) {
    const prisma = this.tenancy.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, filters);
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const po = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    return po;
  }

  async create(identity: RequestIdentity, dto: CreatePurchaseOrderDto) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    if (!dto.lines || dto.lines.length === 0) throw new BadRequestException('At least one line is required');

    const resolvedLines = await this.resolveLines(prisma, orgId, dto.lines);
    const count = await this.repo.countPoNumbers(prisma, orgId);
    const poNumber = `PO-${String(count + 1).padStart(5, '0')}`;

    const po = await this.repo.createWithRevision(prisma, {
      organizationId: orgId,
      supplierId: dto.supplierId,
      poNumber,
      currencyCode: dto.currencyCode,
      effectiveFrom: new Date(dto.effectiveFrom),
      reason: dto.reason,
      deliveryAddress: dto.deliveryAddress,
      expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : undefined,
      createdBy: identity.userId,
      lines: resolvedLines,
    });

    // Wire MR-line allocations after PO lines are created
    const revision = po!.revisions[0];
    await this.wireAllocations(prisma, orgId, revision.lines, dto.lines);

    return this.repo.findById(prisma, orgId, po!.id);
  }

  async submit(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const po = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    const draft = po.revisions.find(r => r.status === 'DRAFT');
    if (!draft) throw new ConflictException('No DRAFT revision to submit');
    await this.repo.updateRevisionStatus(prisma, draft.id, 'SUBMITTED');
    return this.repo.findById(prisma, identity.activeOrganizationId, id);
  }

  async approve(identity: RequestIdentity, id: string, dto: ApprovePurchaseOrderDto) {
    const prisma = this.tenancy.getClient();
    const po = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);

    const submitted = po.revisions.find(r => r.status === 'SUBMITTED');
    if (!submitted) throw new ConflictException('No SUBMITTED revision to approve');

    // Supersede previous ACTIVE revision if one exists
    const currentActive = po.revisions.find(r => r.status === 'ACTIVE');

    // Atomically: approve revision → ACTIVE, supersede old, write CommitmentLedger entries
    await prisma.$transaction(async (tx) => {
      if (currentActive) {
        await this.repo.updateRevisionStatus(tx as any, currentActive.id, 'SUPERSEDED');
        // Write compensating COMMITTED reversal for old revision lines
        for (const line of currentActive.lines) {
          const unitPrice = 'unitPrice' in line ? (line.unitPrice as Decimal) : new Decimal(0);
          const qty = 'orderedQuantity' in line ? (line.orderedQuantity as Decimal) : new Decimal(0);
          const amount = unitPrice.mul(qty).negated();
          await this.commitmentRepo.create(tx as any, {
            organizationId: po.organizationId,
            supplierId: po.supplierId,
            purchaseOrderId: po.id,
            spendCategoryId: (line as any).spendCategoryId ?? undefined,
            stage: 'COMMITTED',
            amount,
            currencyCode: submitted.currencyCode,
            reportingAmount: amount.mul(new Decimal(dto.exchangeRate)),
            exchangeRateSnapshot: new Decimal(dto.exchangeRate),
            sourceDocumentType: 'PO_CANCELLATION',
            sourceDocumentId: po.id,
            sourceLineId: line.id,
            sourceRevision: currentActive.revisionNumber,
            eventType: 'REVISION_SUPERSEDED',
            idempotencyKey: `po-supersede-${currentActive.id}-${line.id}`,
            occurredAt: new Date(),
            accountingDate: new Date(submitted.effectiveFrom),
          });
        }
      }

      // Mark submitted revision as ACTIVE
      await this.repo.updateRevisionStatus(tx as any, submitted.id, 'ACTIVE', {
        approvedBy: identity.userId,
        approvedAt: new Date(),
      });
      await this.repo.updatePoStatus(tx as any, po.id, 'OPEN', submitted.id);

      // Write COMMITTED entries for new revision lines (ADR-007, Rule CL-001)
      for (const line of submitted.lines) {
        const unitPrice = 'unitPrice' in line ? (line.unitPrice as Decimal) : new Decimal(0);
        const qty = 'orderedQuantity' in line ? (line.orderedQuantity as Decimal) : new Decimal(0);
        const amount = unitPrice.mul(qty);
        await this.commitmentRepo.create(tx as any, {
          organizationId: po.organizationId,
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          spendCategoryId: (line as any).spendCategoryId ?? undefined,
          stage: 'COMMITTED',
          amount,
          currencyCode: submitted.currencyCode,
          reportingAmount: amount.mul(new Decimal(dto.exchangeRate)),
          exchangeRateSnapshot: new Decimal(dto.exchangeRate),
          sourceDocumentType: 'PURCHASE_ORDER_REVISION',
          sourceDocumentId: po.id,
          sourceLineId: line.id,
          sourceRevision: submitted.revisionNumber,
          eventType: 'PO_APPROVED',
          idempotencyKey: `po-commit-${submitted.id}-${line.id}`,
          occurredAt: new Date(),
          accountingDate: new Date(submitted.effectiveFrom),
        });
      }
    });

    return this.repo.findById(prisma, identity.activeOrganizationId, id);
  }

  async revise(identity: RequestIdentity, id: string, dto: RevisePoDto) {
    const prisma = this.tenancy.getClient();
    const po = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    if (po.status !== 'OPEN') throw new ConflictException('Can only revise an OPEN purchase order');

    const hasDraft = po.revisions.some(r => r.status === 'DRAFT');
    if (hasDraft) throw new ConflictException('A DRAFT revision already exists — submit or cancel it first');

    const nextRevNum = Math.max(...po.revisions.map(r => r.revisionNumber)) + 1;
    const orgId = identity.activeOrganizationId;
    const resolvedLines = await this.resolveLines(prisma, orgId, dto.lines);

    const newRev = await this.repo.createRevision(prisma, po.id, nextRevNum, {
      currencyCode: dto.currencyCode,
      effectiveFrom: new Date(dto.effectiveFrom),
      reason: dto.reason,
      deliveryAddress: dto.deliveryAddress,
      expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : undefined,
      createdBy: identity.userId,
      lines: resolvedLines,
    });

    await this.wireAllocations(prisma, orgId, newRev.lines, dto.lines);
    return this.repo.findById(prisma, orgId, id);
  }

  async cancel(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const po = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    if (po.status === 'CANCELLED') throw new ConflictException('Purchase order is already cancelled');

    // Cancel all non-terminal revisions
    for (const rev of po.revisions) {
      if (rev.status !== 'SUPERSEDED' && rev.status !== 'CANCELLED') {
        await this.repo.updateRevisionStatus(prisma, rev.id, 'CANCELLED');
      }
    }
    await this.repo.updatePoStatus(prisma, po.id, 'CANCELLED');
    return this.repo.findById(prisma, identity.activeOrganizationId, id);
  }

  private async resolveLines(prisma: any, orgId: string, dtoLines: CreatePoLineDto[]) {
    return Promise.all(
      dtoLines.map(async (line, i) => {
        if (line.lineType === 'MATERIAL' && !line.materialCode) {
          throw new BadRequestException(`Line ${i + 1}: materialCode required for MATERIAL type`);
        }

        let materialId: string | undefined;
        let resolvedUomId: string;

        if (line.materialCode) {
          const material = await this.materialRepo.findByCode(prisma, orgId, line.materialCode);
          if (!material) throw new NotFoundException(`Line ${i + 1}: material '${line.materialCode}' not found`);
          materialId = material.id;
          resolvedUomId = material.baseUnitOfMeasureId;
        } else {
          const uom = await this.uomRepo.findByCode(prisma, orgId, line.uomCode);
          if (!uom) throw new NotFoundException(`Line ${i + 1}: UoM '${line.uomCode}' not found`);
          resolvedUomId = uom.id;
        }

        const qty = new Decimal(line.orderedQuantity);
        const price = new Decimal(line.unitPrice);

        return {
          lineNumber: i + 1,
          lineType: line.lineType,
          materialId,
          description: line.description,
          unitOfMeasureId: resolvedUomId,
          orderedQuantity: qty,
          unitPrice: price,
          extendedAmount: qty.mul(price),
          spendCategoryId: line.spendCategoryId,
          taxCodeId: line.taxCodeId,
          notes: line.notes,
        };
      }),
    );
  }

  private async wireAllocations(prisma: any, orgId: string, revLines: any[], dtoLines: CreatePoLineDto[]) {
    for (let i = 0; i < revLines.length; i++) {
      const poLine = revLines[i];
      const dtoLine = dtoLines[i];
      if (!dtoLine.mrLineAllocations?.length) continue;

      for (const alloc of dtoLine.mrLineAllocations) {
        // Rule ALLOC-001: total PO allocations for an MR line must not exceed MR requestedQuantity
        const mrLine = await prisma.materialRequestLine.findUnique({
          where: { id: alloc.materialRequestLineId },
          include: {
            poAllocations: {
              select: { allocatedQuantity: true },
            },
          },
        });
        if (!mrLine) {
          throw new BadRequestException(`MR line ${alloc.materialRequestLineId} not found`);
        }

        const existingTotal = (mrLine.poAllocations as any[]).reduce(
          (sum: Decimal, a: any) => sum.add(a.allocatedQuantity as Decimal),
          new Decimal(0),
        );
        const newTotal = existingTotal.add(new Decimal(alloc.allocatedQuantity));
        const cap = (mrLine.approvedQuantity ?? mrLine.requestedQuantity) as Decimal;

        if (newTotal.greaterThan(cap)) {
          throw new BadRequestException(
            `MR line ${alloc.materialRequestLineId}: total PO allocation (${newTotal}) would exceed ` +
            `approved quantity (${cap}). Reduce the allocated quantity.`,
          );
        }

        await this.repo.createLineAllocation(prisma, {
          organizationId: orgId,
          purchaseOrderLineId: poLine.id,
          materialRequestLineId: alloc.materialRequestLineId,
          allocatedQuantity: new Decimal(alloc.allocatedQuantity),
        });
      }
    }
  }
}
