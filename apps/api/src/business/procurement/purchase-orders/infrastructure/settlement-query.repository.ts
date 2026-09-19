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
      include: { allocations: { select: { allocatedAmount: true } } },
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
