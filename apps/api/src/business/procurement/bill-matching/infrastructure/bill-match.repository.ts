import { Injectable } from '@nestjs/common';
import type {
  PrismaClient,
  BillMatchType,
  BillMatchStatus,
  MatchExceptionReason,
  MatchResolutionAction,
} from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateMatchLineData {
  supplierBillLineId: string;
  purchaseOrderLineId: string;
  goodsReceiptLineId?: string;
  poQuantity: Decimal;
  receivedQuantity?: Decimal;
  billedQuantity: Decimal;
  poUnitPrice: Decimal;
  billedUnitPrice: Decimal;
  quantityVariance: Decimal;
  priceVariance: Decimal;
  amountVariance: Decimal;
  // ADR-018 CONST-MATCH-003: per-dimension verdicts. `withinTolerance` is the derived overall.
  quantityWithinTolerance: boolean;
  priceWithinTolerance: boolean;
  amountWithinTolerance: boolean;
  withinTolerance: boolean;
  exceptionReason?: string;
}

@Injectable()
export class BillMatchRepository {
  findByBillId(prisma: TenantPrisma, supplierBillId: string) {
    return prisma.supplierBillMatch.findUnique({
      where: { supplierBillId },
      include: { lines: { include: { purchaseOrderLine: true } } },
    });
  }

  async createOrReplace(
    prisma: TenantPrisma,
    supplierBillId: string,
    matchType: BillMatchType,
    lines: CreateMatchLineData[],
  ) {
    // Delete previous match if exists (re-run scenario)
    const existing = await prisma.supplierBillMatch.findUnique({ where: { supplierBillId } });
    if (existing) {
      await prisma.supplierBillMatchLine.deleteMany({ where: { supplierBillMatchId: existing.id } });
      await prisma.supplierBillMatch.delete({ where: { supplierBillId } });
    }

    return prisma.supplierBillMatch.create({
      data: {
        supplierBillId,
        matchType,
        lines: {
          create: lines.map(({ purchaseOrderLineId, ...rest }) => ({
            ...rest,
            purchaseOrderLine: { connect: { id: purchaseOrderLineId } },
          })),
        },
      },
      include: { lines: { include: { purchaseOrderLine: true } } },
    });
  }

  updateStatus(
    prisma: TenantPrisma,
    supplierBillId: string,
    status: BillMatchStatus,
    extra?: {
      matchedAt?: Date;
      matchedBy?: string;
      approvedBy?: string;
      approvedAt?: Date;
      approvalReason?: string;
      resolutionReason?: MatchExceptionReason;
      resolutionAction?: MatchResolutionAction;
      resolutionNotes?: string;
    },
  ) {
    return prisma.supplierBillMatch.update({
      where: { supplierBillId },
      data: { status, ...extra },
    });
  }

  findOrgTolerancePolicy(prisma: TenantPrisma, organizationId: string) {
    return prisma.matchingTolerancePolicy.findFirst({
      where: { organizationId, scopeType: 'ORGANIZATION', status: 'ACTIVE' },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  findPoTolerancePolicy(prisma: TenantPrisma, organizationId: string, purchaseOrderId: string) {
    return prisma.matchingTolerancePolicy.findFirst({
      where: { organizationId, scopeType: 'PURCHASE_ORDER', purchaseOrderId, status: 'ACTIVE' },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  findBillForMatching(prisma: TenantPrisma, organizationId: string, billId: string) {
    return prisma.supplierBill.findFirst({
      where: { id: billId, organizationId },
      include: { lines: { include: { material: true } } },
    });
  }

  findPoRevisionForMatching(prisma: TenantPrisma, revisionId: string) {
    return prisma.purchaseOrderRevision.findFirst({
      where: { id: revisionId },
      include: { lines: { include: { material: true } }, purchaseOrder: true },
    });
  }

  // ADR-018 Phase 2b: match against the PO's CURRENT active revision, so a re-match after an approved
  // PO revision picks up the revised terms (and the recommitted exposure).
  findActivePoRevisionForPo(prisma: TenantPrisma, purchaseOrderId: string) {
    return prisma.purchaseOrderRevision.findFirst({
      where: { purchaseOrderId, status: 'ACTIVE' },
      include: { lines: { include: { material: true } }, purchaseOrder: true },
    });
  }

  repointBillToRevision(prisma: TenantPrisma, billId: string, purchaseOrderRevisionId: string) {
    return prisma.supplierBill.update({ where: { id: billId }, data: { purchaseOrderRevisionId } });
  }

  // Received quantity is physical and revision-independent, so it is summed by material across the
  // whole PO (all posted GRNs, any revision) — otherwise a price-only revision would lose it.
  async sumReceivedForPoMaterial(
    prisma: TenantPrisma,
    purchaseOrderId: string,
    materialId: string,
  ): Promise<Decimal | null> {
    const agg = await prisma.goodsReceiptLine.aggregate({
      where: { materialId, grn: { purchaseOrderId, status: 'POSTED' } },
      _sum: { acceptedQuantity: true },
    });
    return agg._sum.acceptedQuantity;
  }

  findGrnLineForPoMaterial(prisma: TenantPrisma, purchaseOrderId: string, materialId: string) {
    return prisma.goodsReceiptLine.findFirst({
      where: { materialId, grn: { purchaseOrderId, status: 'POSTED' } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findGrnLineForPoLine(prisma: TenantPrisma, poLineId: string, poRevisionId: string) {
    return prisma.goodsReceiptLine.findFirst({
      where: {
        purchaseOrderLineId: poLineId,
        grn: { status: 'POSTED', purchaseOrderRevisionId: poRevisionId },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ADR-018 CONST-MATCH-005: total accepted quantity received against a PO line (all posted GRNs).
  async sumReceivedForPoLine(prisma: TenantPrisma, poLineId: string): Promise<Decimal | null> {
    const agg = await prisma.goodsReceiptLine.aggregate({
      where: { purchaseOrderLineId: poLineId, grn: { status: 'POSTED' } },
      _sum: { acceptedQuantity: true },
    });
    return agg._sum.acceptedQuantity;
  }

  // ADR-018 CONST-MATCH-006: quantity already billed against a PO line on other accepted matches
  // (excluding the bill being matched now), so matching is cumulative rather than invoice-isolated.
  async sumBilledForPoLineExcludingBill(
    prisma: TenantPrisma,
    poLineId: string,
    excludeBillId: string,
  ): Promise<Decimal | null> {
    const agg = await prisma.supplierBillMatchLine.aggregate({
      where: {
        purchaseOrderLineId: poLineId,
        billMatch: {
          supplierBillId: { not: excludeBillId },
          status: { in: ['MATCHED', 'MATCHED_WITH_TOLERANCE', 'APPROVED_EXCEPTION'] },
        },
      },
      _sum: { billedQuantity: true },
    });
    return agg._sum.billedQuantity;
  }

  // ADR-018/ADR-024 item D — the bill's total, used to route exception-approval authority (FM ≤ USD
  // 1,000, CFO above). The same figure the posting gate and the DOA bands use.
  async findBillTotal(prisma: TenantPrisma, billId: string): Promise<Decimal | null> {
    const bill = await prisma.supplierBill.findUnique({
      where: { id: billId },
      select: { totalAmount: true },
    });
    return bill?.totalAmount ?? null;
  }

  updateBillMatchStatus(prisma: TenantPrisma, billId: string, matchStatus: string) {
    return prisma.supplierBill.update({
      where: { id: billId },
      data: { matchStatus: matchStatus as never },
    });
  }
}
