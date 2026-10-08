import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class SettlementQueryRepository {
  findPoForSettlement(prisma: TenantPrisma, organizationId: string, purchaseOrderId: string) {
    return prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId },
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        revisions: {
          include: {
            lines: {
              include: { uom: { select: { symbol: true } } },
              orderBy: { lineNumber: 'asc' },
            },
          },
          orderBy: { revisionNumber: 'asc' },
        },
      },
    });
  }

  // Accepted quantity per PO line across all POSTED GRNs, including over-receipt flag
  async receivedByPoLine(
    prisma: TenantPrisma,
    purchaseOrderId: string,
  ): Promise<{ byLine: Map<string, Decimal>; hasOverReceipt: boolean }> {
    const [lines, overReceiptGrn] = await Promise.all([
      prisma.goodsReceiptLine.findMany({
        where: { grn: { purchaseOrderId, status: 'POSTED' } },
        select: { purchaseOrderLineId: true, acceptedQuantity: true },
      }),
      prisma.goodsReceiptNote.findFirst({
        where: { purchaseOrderId, status: 'POSTED', overReceiptFlag: true },
        select: { id: true },
      }),
    ]);

    const byLine = new Map<string, Decimal>();
    for (const line of lines) {
      const existing = byLine.get(line.purchaseOrderLineId);
      const qty = line.acceptedQuantity as Decimal;
      byLine.set(line.purchaseOrderLineId, existing ? existing.add(qty) : qty);
    }

    return { byLine, hasOverReceipt: !!overReceiptGrn };
  }

  // Pre-bill funding allocations (Finance links payment to PO before bill exists).
  // Only allocations whose parent SupplierPayment has been POSTED count as real disbursements —
  // a DRAFT or APPROVED payment has not yet left ACCO's bank account.
  findPurchaseAllocations(prisma: TenantPrisma, organizationId: string, purchaseOrderId: string) {
    return prisma.supplierPaymentPurchaseAllocation.findMany({
      where: {
        purchaseOrderId,
        organizationId,
        supplierPayment: { postingStatus: 'POSTED' },
      },
      include: { supplierPayment: { select: { id: true, paymentNumber: true } } },
      orderBy: { allocationDate: 'asc' },
    });
  }

  // Supplier bills linked directly to this PO (via purchaseOrderId FK on SupplierBill)
  findBillsForPo(prisma: TenantPrisma, organizationId: string, purchaseOrderId: string) {
    return prisma.supplierBill.findMany({
      where: { organizationId, purchaseOrderId },
      include: {
        allocations: {
          select: {
            allocatedAmount: true,
            postingStatus: true,
            payment: { select: { postingStatus: true, purchaseAllocations: { where: { purchaseOrderId }, select: { id: true } } } },
          },
        },
        // ADR-045 — buyer cash applied to the bill (EVT-AP-008).
        advanceEvidenceAllocations: { select: { allocatedAmount: true, postingStatus: true } },
      },
      orderBy: { billDate: 'asc' },
    });
  }

  /** The distinct projects a PO's lines (any revision) are coded to — what project access checks. */
  async findPoProjectIds(prisma: TenantPrisma, organizationId: string, purchaseOrderId: string) {
    const lines = await prisma.purchaseOrderLine.findMany({
      where: { projectId: { not: null }, revision: { purchaseOrderId, purchaseOrder: { organizationId } } },
      select: { projectId: true },
      distinct: ['projectId'],
    });
    return lines.map((l) => l.projectId).filter((id): id is string => Boolean(id));
  }

  async purchaseOrderExists(prisma: TenantPrisma, organizationId: string, purchaseOrderId: string) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId },
      select: { id: true },
    });
    return po !== null;
  }

  /**
   * ADR-043 decision 4 — the PO's supplier bills with every payment allocation and its payment
   * date, for procurement's read-only payment status. Org-scoped like the settlement read.
   */
  findBillPaymentsForPo(prisma: TenantPrisma, organizationId: string, purchaseOrderId: string) {
    return prisma.supplierBill.findMany({
      where: { organizationId, purchaseOrderId },
      select: {
        id: true,
        billNumber: true,
        supplierInvoiceNumber: true,
        billDate: true,
        dueDate: true,
        currencyCode: true,
        documentStatus: true,
        postingStatus: true,
        totalAmount: true,
        outstandingAmount: true,
        allocations: {
          select: {
            allocatedAmount: true,
            postingStatus: true,
            supplierPaymentId: true,
            payment: { select: { paymentDate: true } },
          },
        },
        advanceEvidenceAllocations: {
          select: { buyerAdvanceId: true, allocatedAmount: true, allocationDate: true, postingStatus: true },
        },
      },
      orderBy: { billDate: 'asc' },
    });
  }

  // Buyer advances for this PO with returns and evidence allocations.
  // Only POSTED advances count as real disbursements — a DRAFT advance means money has not
  // yet left ACCO's bank account and must not inflate the funded total.
  findBuyerAdvances(prisma: TenantPrisma, organizationId: string, purchaseOrderId: string) {
    return prisma.buyerAdvance.findMany({
      where: { purchaseOrderId, organizationId, postingStatus: 'POSTED' },
      include: {
        returns: { select: { id: true, amount: true, returnMethod: true, receivedAt: true } },
        evidenceAllocations: {
          include: { supplierBill: { select: { id: true, billNumber: true } } },
        },
      },
      orderBy: { advancedAt: 'asc' },
    });
  }

  findUsers(prisma: TenantPrisma, organizationId: string, userIds: string[]) {
    if (!userIds.length) return Promise.resolve([]);
    return prisma.user.findMany({
      where: { id: { in: userIds }, organizationId },
      select: { id: true, firstName: true, lastName: true },
    });
  }
}
