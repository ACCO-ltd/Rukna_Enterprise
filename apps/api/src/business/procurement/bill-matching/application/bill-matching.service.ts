import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BillMatchRepository } from '../infrastructure/bill-match.repository.js';

export interface ApproveExceptionDto {
  approvalReason: string;
}

@Injectable()
export class BillMatchingService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: BillMatchRepository,
  ) {}

  async findByBillId(identity: RequestIdentity, billId: string) {
    const prisma = this.tenancy.getClient();
    const match = await this.repo.findByBillId(prisma, billId);
    if (!match) throw new NotFoundException(`No match result found for bill ${billId}`);
    return match;
  }

  async runMatching(identity: RequestIdentity, billId: string) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const bill = await this.repo.findBillForMatching(prisma, orgId, billId);
    if (!bill) throw new NotFoundException(`Supplier bill ${billId} not found`);
    if (bill.postingStatus === 'POSTED') throw new ConflictException('Cannot re-match a posted bill');

    if (!bill.purchaseOrderRevisionId) {
      throw new BadRequestException('Bill is not linked to a PO revision — cannot run matching');
    }

    // Determine match type: THREE_WAY if any MATERIAL line, else TWO_WAY (ADR-007, Rule MATCH-001)
    const hasMaterialLine = bill.lines.some(l => l.lineType === 'MATERIAL');
    const matchType = hasMaterialLine ? 'THREE_WAY' : 'TWO_WAY';

    const poRevision = await this.repo.findPoRevisionForMatching(prisma, bill.purchaseOrderRevisionId);
    if (!poRevision) throw new NotFoundException('Associated PO revision not found');

    const poPolicy = await this.repo.findPoTolerancePolicy(prisma, orgId, poRevision.purchaseOrderId);
    const orgPolicy = await this.repo.findOrgTolerancePolicy(prisma, orgId);
    const policy = poPolicy ?? orgPolicy;

    const priceTolPct = policy?.priceVariancePercent ? new Decimal(policy.priceVariancePercent) : null;
    const qtyTolPct = policy?.quantityVariancePercent ? new Decimal(policy.quantityVariancePercent) : null;

    const matchLines = await Promise.all(
      bill.lines.map(async (billLine, idx) => {
        // Match by materialId when present (MATERIAL lines), else by position
        const poLine = billLine.materialId
          ? poRevision.lines.find(l => l.materialId === billLine.materialId)
          : poRevision.lines[idx];

        if (!poLine) {
          throw new BadRequestException(`No matching PO line found for bill line ${billLine.lineNumber}`);
        }

        const poQty = poLine.orderedQuantity as Decimal;
        const poPrice = poLine.unitPrice as Decimal;
        const billedQty = new Decimal(billLine.quantity ?? 0);
        const billedPrice = new Decimal(billLine.unitPrice ?? 0);

        const qtyVar = billedQty.sub(poQty);
        const priceVar = billedPrice.sub(poPrice);
        const amtVar = billedQty.mul(billedPrice).sub(poQty.mul(poPrice));

        const qtyVarPct = poQty.greaterThan(0) ? qtyVar.abs().div(poQty).mul(100) : new Decimal(0);
        const priceVarPct = poPrice.greaterThan(0) ? priceVar.abs().div(poPrice).mul(100) : new Decimal(0);

        const qtyOk = !qtyTolPct || qtyVarPct.lessThanOrEqualTo(qtyTolPct);
        const priceOk = !priceTolPct || priceVarPct.lessThanOrEqualTo(priceTolPct);
        const withinTolerance = qtyOk && priceOk;

        let grnLineId: string | undefined;
        let receivedQty: Decimal | undefined;
        if (matchType === 'THREE_WAY') {
          const grnLine = await this.repo.findGrnLineForPoLine(prisma, poLine.id, bill.purchaseOrderRevisionId!);
          if (grnLine) {
            grnLineId = grnLine.id;
            receivedQty = grnLine.acceptedQuantity as Decimal;
          }
        }

        return {
          supplierBillLineId: billLine.id,
          purchaseOrderLineId: poLine.id,
          goodsReceiptLineId: grnLineId,
          poQuantity: poQty,
          receivedQuantity: receivedQty,
          billedQuantity: billedQty,
          poUnitPrice: poPrice,
          billedUnitPrice: billedPrice,
          quantityVariance: qtyVar,
          priceVariance: priceVar,
          amountVariance: amtVar,
          withinTolerance,
          exceptionReason: withinTolerance
            ? undefined
            : `Qty variance: ${qtyVarPct.toFixed(2)}%, Price variance: ${priceVarPct.toFixed(2)}%`,
        };
      }),
    );

    const allWithinTolerance = matchLines.every(l => l.withinTolerance);
    const finalStatus = allWithinTolerance ? 'MATCHED' : 'MATCHED_WITH_TOLERANCE';

    await this.repo.createOrReplace(prisma, billId, matchType, matchLines);
    await this.repo.updateStatus(prisma, billId, finalStatus, {
      matchedAt: new Date(),
      matchedBy: identity.userId,
    });
    await this.repo.updateBillMatchStatus(prisma, billId, finalStatus);

    return this.repo.findByBillId(prisma, billId);
  }

  async approveException(identity: RequestIdentity, billId: string, dto: ApproveExceptionDto) {
    const prisma = this.tenancy.getClient();
    const match = await this.repo.findByBillId(prisma, billId);
    if (!match) throw new NotFoundException(`No match result for bill ${billId}`);
    if (match.status !== 'EXCEPTION' && match.status !== 'MATCHED_WITH_TOLERANCE') {
      throw new ConflictException(`Match status is ${match.status} — no exception to approve`);
    }

    await this.repo.updateStatus(prisma, billId, 'APPROVED_EXCEPTION', {
      approvedBy: identity.userId,
      approvedAt: new Date(),
      approvalReason: dto.approvalReason,
    });
    await this.repo.updateBillMatchStatus(prisma, billId, 'APPROVED_EXCEPTION');

    return this.repo.findByBillId(prisma, billId);
  }
}
