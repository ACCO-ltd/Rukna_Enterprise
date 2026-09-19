import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';
import type {
  Prisma,
  PrismaClient,
  PurchaseOrderStatus,
  ProcurementLineType,
  PoRevisionAttachmentPurpose,
} from '@prisma/client';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { PurchaseOrderRepository } from '../infrastructure/purchase-order.repository.js';
import { PurchaseOrderAttachmentRepository } from '../infrastructure/purchase-order-attachment.repository.js';
import { MaterialRepository } from '../../catalogue/infrastructure/material.repository.js';
import { UomRepository } from '../../catalogue/infrastructure/uom.repository.js';
import { CommitmentLedgerWriter } from '../../commitment-ledger/application/commitment-ledger-writer.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';
import { validateCostTarget, costTargetViolationMessage } from '../domain/cost-target.policy.js';
import { SettlementQueryService } from './settlement-query.service.js';

export interface CreatePoLineDto {
  lineType: ProcurementLineType;
  materialCode?: string;
  description: string;
  uomCode: string;
  orderedQuantity: number;
  unitPrice: number;
  spendCategoryId?: string;
  taxCodeId?: string;
  // Cost-target (A3/D7): both set for a project-cost-relevant line, both omitted for org lines.
  projectId?: string;
  boqNodeId?: string;
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

export interface AttachPoRevisionFileDto {
  platformFileId: string;
  purpose?: PoRevisionAttachmentPurpose;
  supplierRef?: string;
}

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

type RevisionLineForAllocation = { id: string };

@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: PurchaseOrderRepository,
    private readonly attachmentRepo: PurchaseOrderAttachmentRepository,
    private readonly materialRepo: MaterialRepository,
    private readonly uomRepo: UomRepository,
    private readonly commitmentWriter: CommitmentLedgerWriter,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly commandGovernance: CommandGovernanceService,
    private readonly sod: SegregationOfDutiesService,
    private readonly settlementQueryService: SettlementQueryService,
  ) {}

  findAll(
    identity: RequestIdentity,
    filters?: { status?: PurchaseOrderStatus; supplierId?: string; projectId?: string },
  ) {
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

    if (!dto.lines || dto.lines.length === 0)
      throw new BadRequestException('At least one line is required');

    // ADR-022 CONST-DOA-003: the vendor maintainer cannot also create a PO to that vendor.
    const supplier = await prisma.supplier.findFirst({
      where: { id: dto.supplierId, organizationId: orgId },
      select: { createdBy: true },
    });
    await this.sod.assertAllowed({
      organizationId: orgId,
      action: 'CREATE_PURCHASE_ORDER',
      actorUserId: identity.userId,
      vendorMaintainerUserId: supplier?.createdBy ?? undefined,
    });

    const resolvedLines = await this.resolveLines(prisma, orgId, dto.lines);
    const count = await this.repo.countPoNumbers(prisma, orgId);
    const poNumber = `PO-${String(count + 1).padStart(5, '0')}`;

    const po = await prisma.$transaction(async (tx) => {
      const created = await this.repo.createWithRevision(tx, {
        organizationId: orgId,
        supplierId: dto.supplierId,
        poNumber,
        currencyCode: dto.currencyCode,
        effectiveFrom: new Date(dto.effectiveFrom),
        reason: dto.reason,
        deliveryAddress: dto.deliveryAddress,
        expectedDeliveryDate: dto.expectedDeliveryDate
          ? new Date(dto.expectedDeliveryDate)
          : undefined,
        createdBy: identity.userId,
        lines: resolvedLines,
      });

      const revision = created!.revisions[0];
      await this.wireAllocations(tx, orgId, revision.lines, dto.lines);

      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'PurchaseOrder',
        resourceId: created!.id,
        sourceCommand: 'po.create',
        eventType: 'PO_CREATED',
        idempotencyKey: `po-create-${created!.id}`,
        after: { poNumber, supplierId: dto.supplierId, status: 'DRAFT' },
      });

      return created;
    });

    return this.repo.findById(prisma, orgId, po!.id);
  }

  async confirm(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const po = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);

    const draft = po.revisions.find((r) => r.status === 'DRAFT');
    if (!draft) throw new ConflictException('No DRAFT revision to confirm');

    // When amending an already-confirmed PO, supersede the current ACTIVE revision
    const currentActive = po.revisions.find((r) => r.status === 'ACTIVE');

    await prisma.$transaction(async (tx) => {
      if (currentActive) {
        await this.repo.updateRevisionStatus(tx, currentActive.id, 'SUPERSEDED');
        // P11: reverse only the net uncommitted balance (committed - already_accrued)
        for (const line of currentActive.lines) {
          const committedEntries = await this.commitmentWriter.queryByPoLineAndStage(
            tx, po.organizationId, po.id, line.id, 'COMMITTED',
          );
          const netCommitted = committedEntries.reduce(
            (sum, e) => sum.add(e.amount as Decimal), new Decimal(0),
          );
          if (netCommitted.lessThanOrEqualTo(0)) continue;
          await this.commitmentWriter.committed(tx, {
            organizationId: po.organizationId,
            projectId: line.projectId ?? undefined,
            boqNodeId: line.boqNodeId ?? undefined,
            supplierId: po.supplierId,
            purchaseOrderId: po.id,
            spendCategoryId: line.spendCategoryId ?? undefined,
            amount: netCommitted.negated(),
            currencyCode: draft.currencyCode,
            sourceDocumentType: 'PO_CANCELLATION',
            sourceDocumentId: po.id,
            sourceLineId: line.id,
            sourceRevision: currentActive.revisionNumber,
            eventType: 'REVISION_SUPERSEDED',
            idempotencyKey: `po-supersede-${currentActive.id}-${line.id}`,
            accountingDate: new Date(draft.effectiveFrom),
          });
        }
      }

      await this.repo.updateRevisionStatus(tx, draft.id, 'ACTIVE', {
        approvedBy: identity.userId,
        approvedAt: new Date(),
      });
      await this.repo.updatePoStatus(tx, po.id, 'OPEN', draft.id);

      // Freeze all evidence files on the now-confirmed revision (Slice 2C).
      await this.attachmentRepo.freezeRevisionAttachments(tx, draft.id);

      // Write COMMITTED entries for confirmed revision lines (ADR-007, Rule CL-001)
      for (const line of draft.lines) {
        const unitPrice = line.unitPrice as Decimal;
        const qty = line.orderedQuantity as Decimal;
        await this.commitmentWriter.committed(tx, {
          organizationId: po.organizationId,
          projectId: line.projectId ?? undefined,
          boqNodeId: line.boqNodeId ?? undefined,
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          spendCategoryId: line.spendCategoryId ?? undefined,
          amount: unitPrice.mul(qty),
          currencyCode: draft.currencyCode,
          sourceDocumentType: 'PURCHASE_ORDER_REVISION',
          sourceDocumentId: po.id,
          sourceLineId: line.id,
          sourceRevision: draft.revisionNumber,
          eventType: 'PO_CONFIRMED',
          idempotencyKey: `po-commit-${draft.id}-${line.id}`,
          accountingDate: new Date(draft.effectiveFrom),
        });
      }

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CONFIRM',
        resourceType: 'PurchaseOrder',
        resourceId: id,
        sourceCommand: 'po.confirm',
        eventType: 'PO_CONFIRMED',
        idempotencyKey: `po-confirm-${id}-rev-${draft.id}`,
        before: { revisionStatus: 'DRAFT' },
        after: { revisionStatus: 'ACTIVE', poStatus: 'OPEN' },
      });
    });

    return this.repo.findById(prisma, identity.activeOrganizationId, id);
  }

  async revise(identity: RequestIdentity, id: string, dto: RevisePoDto) {
    const prisma = this.tenancy.getClient();
    const po = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    if (po.status !== 'OPEN') throw new ConflictException('Can only revise an OPEN purchase order');

    const hasDraft = po.revisions.some((r) => r.status === 'DRAFT');
    if (hasDraft)
      throw new ConflictException('A DRAFT revision already exists — submit or cancel it first');

    const nextRevNum = Math.max(...po.revisions.map((r) => r.revisionNumber)) + 1;
    const orgId = identity.activeOrganizationId;
    const resolvedLines = await this.resolveLines(prisma, orgId, dto.lines);

    await prisma.$transaction(async (tx) => {
      const newRev = await this.repo.createRevision(tx, po.id, nextRevNum, {
        currencyCode: dto.currencyCode,
        effectiveFrom: new Date(dto.effectiveFrom),
        reason: dto.reason,
        deliveryAddress: dto.deliveryAddress,
        expectedDeliveryDate: dto.expectedDeliveryDate
          ? new Date(dto.expectedDeliveryDate)
          : undefined,
        createdBy: identity.userId,
        lines: resolvedLines,
      });

      await this.wireAllocations(tx, orgId, newRev.lines, dto.lines);

      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'REVISE',
        resourceType: 'PurchaseOrder',
        resourceId: id,
        sourceCommand: 'po.revise',
        eventType: 'PO_REVISED',
        idempotencyKey: `po-revise-${id}-rev-${nextRevNum}`,
        after: { revisionNumber: nextRevNum, reason: dto.reason },
      });
    });

    return this.repo.findById(prisma, orgId, id);
  }

  async cancel(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const po = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    if (po.status === 'CANCELLED')
      throw new ConflictException('Purchase order is already cancelled');

    await prisma.$transaction(async (tx) => {
      // P12: write COMMITTED reversal for remaining uncommitted balance before cancelling.
      //
      // Accounting date rule: we use effectiveFrom (the original PO confirmation date), NOT new Date().
      // Rationale: CommitmentLedger entries are written directly to prisma.commitmentLedgerEntry —
      // they do NOT go through AccountingPostingService and are NOT subject to PeriodValidator's
      // OPEN/CLOSED/LOCKED enforcement. The accountingDate on commitment entries is used for
      // as-of reporting and cost-period attribution, not GL posting. Using effectiveFrom keeps the
      // reversal paired with the period the commitment was originally charged to, maintaining
      // per-period net-commitment integrity (COMMITTED − ACCRUED is always attributable to the same
      // cost period as the original PO line). If the cancellation crosses a fiscal year boundary,
      // the reversal still correctly zeroes the originally-booked period's commitment.
      const activeRevision = po.revisions.find((r) => r.status === 'ACTIVE');
      if (activeRevision) {
        for (const line of activeRevision.lines) {
          const committedEntries = await this.commitmentWriter.queryByPoLineAndStage(
            tx,
            po.organizationId,
            po.id,
            line.id,
            'COMMITTED',
          );
          const netCommitted = committedEntries.reduce(
            (sum, e) => sum.add(e.amount as Decimal),
            new Decimal(0),
          );
          if (netCommitted.lessThanOrEqualTo(0)) continue;
          await this.commitmentWriter.committed(tx, {
            organizationId: po.organizationId,
            projectId: line.projectId ?? undefined,
            boqNodeId: line.boqNodeId ?? undefined,
            supplierId: po.supplierId,
            purchaseOrderId: po.id,
            spendCategoryId: line.spendCategoryId ?? undefined,
            amount: netCommitted.negated(),
            currencyCode: activeRevision.currencyCode,
            sourceDocumentType: 'PO_CANCELLATION',
            sourceDocumentId: po.id,
            sourceLineId: line.id,
            sourceRevision: activeRevision.revisionNumber,
            eventType: 'PO_CANCELLED',
            idempotencyKey: `po-cancel-${po.id}-${line.id}`,
            accountingDate: new Date(activeRevision.effectiveFrom),
          });
        }
      }

      for (const rev of po.revisions) {
        if (rev.status !== 'SUPERSEDED' && rev.status !== 'CANCELLED') {
          await this.repo.updateRevisionStatus(tx, rev.id, 'CANCELLED');
        }
      }
      await this.repo.updatePoStatus(tx, po.id, 'CANCELLED');

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CANCEL',
        resourceType: 'PurchaseOrder',
        resourceId: id,
        sourceCommand: 'po.cancel',
        eventType: 'PO_CANCELLED',
        idempotencyKey: `po-cancel-${id}`,
        before: { status: po.status },
        after: { status: 'CANCELLED' },
      });
    });

    return this.repo.findById(prisma, identity.activeOrganizationId, id);
  }

  async listRevisionAttachments(identity: RequestIdentity, poId: string) {
    const prisma = this.tenancy.getClient();
    const po = await this.repo.findById(prisma, identity.activeOrganizationId, poId);
    if (!po) throw new NotFoundException(`Purchase order ${poId} not found`);

    // Return the most recent DRAFT or ACTIVE revision's attachments.
    const revision =
      po.revisions.find((r) => r.status === 'DRAFT') ??
      po.revisions.find((r) => r.status === 'ACTIVE');
    if (!revision) throw new NotFoundException(`No active or draft revision for purchase order ${poId}`);

    return this.attachmentRepo.listByRevision(prisma, revision.id);
  }

  async attachToRevision(identity: RequestIdentity, poId: string, dto: AttachPoRevisionFileDto) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const po = await this.repo.findById(prisma, orgId, poId);
    if (!po) throw new NotFoundException(`Purchase order ${poId} not found`);

    const draft = po.revisions.find((r) => r.status === 'DRAFT');
    if (!draft) {
      throw new ConflictException(
        'No DRAFT revision — the purchase order is already confirmed. Use /revise to create a new DRAFT revision before attaching files.',
      );
    }

    const file = await this.attachmentRepo.findFileStatus(prisma, orgId, dto.platformFileId);
    if (!file) throw new NotFoundException(`File ${dto.platformFileId} not found`);
    if (file.status !== 'READY') {
      throw new BadRequestException('The file must be fully uploaded (READY) before it can be attached.');
    }
    if (file.lifecycle !== 'TEMPORARY') {
      throw new BadRequestException('That file is already attached to a record.');
    }
    if (file.uploadedBy !== identity.userId) {
      throw new ForbiddenException('You can only attach a file that you uploaded.');
    }

    const attachment = await this.attachmentRepo.attachToRevision(prisma, {
      organizationId: orgId,
      purchaseOrderRevisionId: draft.id,
      platformFileId: dto.platformFileId,
      purpose: dto.purpose ?? 'QUOTATION',
      supplierRef: dto.supplierRef,
      attachedBy: identity.userId,
    });

    // Bind the file so it cannot be deleted or reused until the revision is confirmed/frozen.
    await prisma.platformFile.update({
      where: { id: dto.platformFileId },
      data: { lifecycle: 'BOUND', boundAt: new Date(), lifecycleReason: `po-revision draft ${draft.id}`.slice(0, 120) },
    });

    return attachment;
  }

  private async resolveLines(prisma: TenantPrisma, orgId: string, dtoLines: CreatePoLineDto[]) {
    return Promise.all(
      dtoLines.map(async (line, i) => {
        if (line.lineType === 'MATERIAL' && !line.materialCode) {
          throw new BadRequestException(`Line ${i + 1}: materialCode required for MATERIAL type`);
        }

        let materialId: string | undefined;
        let resolvedUomId: string;

        if (line.materialCode) {
          const material = await this.materialRepo.findByCode(prisma, orgId, line.materialCode);
          if (!material)
            throw new NotFoundException(`Line ${i + 1}: material '${line.materialCode}' not found`);
          materialId = material.id;
          resolvedUomId = material.baseUnitOfMeasureId;
        } else {
          const uom = await this.uomRepo.findByCode(prisma, orgId, line.uomCode);
          if (!uom) throw new NotFoundException(`Line ${i + 1}: UoM '${line.uomCode}' not found`);
          resolvedUomId = uom.id;
        }

        // Cost-target (A3/D7). Resolve the node only when one was supplied; the policy decides
        // which of the three valid attributions this is — corporate, project-level (non-BOQ),
        // or BOQ-coded — and rejects the two impossible ones.
        const resolvedNode = line.boqNodeId
          ? await this.repo.resolveCostNode(prisma, orgId, line.boqNodeId)
          : null;
        const violation = validateCostTarget(
          {
            projectId: line.projectId,
            boqNodeId: line.boqNodeId,
            spendCategoryId: line.spendCategoryId,
          },
          resolvedNode,
        );
        if (violation) {
          throw new BadRequestException(`Line ${i + 1}: ${costTargetViolationMessage(violation)}`);
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
          projectId: line.projectId,
          boqNodeId: line.boqNodeId,
          notes: line.notes,
        };
      }),
    );
  }

  /**
   * Side-effect hook: called after any action that can affect settlement (GRN post, advance
   * return, evidence allocation, direct payment allocation). Closes the PO if all conditions
   * for SETTLED are met. Swallows errors so primary actions are never broken.
   */
  async autoCloseIfSettled(identity: RequestIdentity, poId: string): Promise<void> {
    try {
      const settlement = await this.settlementQueryService.getSettlement(identity, poId);
      if (settlement.settlementStatus !== 'SETTLED') return;

      const prisma = this.tenancy.getClient();
      await prisma.purchaseOrder.updateMany({
        where: { id: poId, organizationId: identity.activeOrganizationId, status: 'OPEN' },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    } catch {
      // Non-critical side-effect — swallow to avoid failing the primary action
    }
  }

  private async wireAllocations(
    prisma: Prisma.TransactionClient,
    orgId: string,
    revLines: RevisionLineForAllocation[],
    dtoLines: CreatePoLineDto[],
  ) {
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

        const existingTotal = mrLine.poAllocations.reduce(
          (sum, allocation) => sum.add(allocation.allocatedQuantity),
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
