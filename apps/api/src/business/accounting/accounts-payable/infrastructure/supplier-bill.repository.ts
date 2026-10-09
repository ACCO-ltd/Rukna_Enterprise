import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateSupplierBillData {
  organizationId: string;
  supplierId: string;
  supplierInvoiceNumber: string;
  billDate: Date;
  dueDate: Date;
  currencyCode: string;
  purchaseOrderId?: string;
  purchaseOrderRevisionId?: string;
  projectId?: string;
  departmentId?: string;
  subtotal: Decimal;
  vatAmount: Decimal;
  totalAmount: Decimal;
  createdBy: string;
  lines: {
    lineNumber: number;
    description: string;
    quantity?: Decimal;
    unitPrice?: Decimal;
    netAmount: Decimal;
    vatAmount: Decimal;
    grossAmount: Decimal;
    expenseProfileCode: string;
    projectId?: string;
    departmentId?: string;
    costCenterId?: string;
    boqNodeId?: string;
    spendCategoryId?: string;
    /** ADR-045 — a bill recorded from a store document copies its PO line's identity (3-way match). */
    lineType?: 'MATERIAL' | 'SERVICE' | 'OTHER';
    materialId?: string;
    unitOfMeasureId?: string;
    purchaseOrderLineId?: string;
  }[];
}

// D7 (capture-once, inherit downstream): the cost-target a PO-backed bill line inherits from its
// matched PO line. Resolved from the SupplierBillMatch (guaranteed present for a PO-backed bill by the
// posting gate) so BOTH the GL journal line AND the ACTUAL/ACCRUED commitment attribute to the SAME
// project/node the PO COMMITTED and the GRN ACCRUED used.
//
// The GL used to take its attribution from whatever the AP clerk keyed on the bill line instead, which
// made project cost in the accounts and project cost in the ledger two independent variables that
// nothing reconciled — and, since no bill form ever sent a project at all, the GL side was always null.
//
// `accruedBasis` is the amount the goods receipt actually accrued for the quantity this bill covers:
// billedQuantity × poUnitPrice. Releasing the accrual at the bill's gross amount instead left a
// permanent −VAT residual in ACCRUED, because the accrual was raised net of a tax the bill adds.
export interface BillLineCostTarget {
  supplierBillLineId: string;
  purchaseOrderLineId: string;
  projectId: string | null;
  boqNodeId: string | null;
  spendCategoryId: string | null;
  accruedBasis: Decimal;
}

/**
 * The duplicate-detection key for a supplier invoice number: trimmed, upper-cased, and stripped
 * of everything but letters and digits. The web form mirrors this exactly to warn before saving.
 */
export function normalizeSupplierInvoiceNumber(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * A bill belongs to a project when it is coded to it on its header or on any line — a bill for
 * several projects is coded per line, and each of those projects must see it. One rule for the
 * bills list (`GET /bills?projectId`) and the Finance portfolio's bills to pay (ADR-043).
 */
export function supplierBillProjectWhere(projectId: string | { in: string[] }) {
  return {
    OR: [{ projectId }, { lines: { some: { projectId } } }],
  };
}

@Injectable()
export class SupplierBillRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.supplierBill.findFirst({
      where: { id, organizationId },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
        supplier: { select: { id: true, code: true, name: true } },
        // ADR-045 — the store receipt / invoice the bill was recorded from (its evidence).
        storeDocument: {
          select: {
            id: true,
            number: true,
            kind: true,
            photos: { select: { platformFileId: true, pageNumber: true }, orderBy: { pageNumber: 'asc' } },
          },
        },
      },
    });
  }

  /** Every payment allocation against a bill, oldest first, with the paying document's identity. */
  findAllocationsForBill(prisma: TenantPrisma, organizationId: string, billId: string) {
    return prisma.supplierPaymentAllocation.findMany({
      where: { organizationId, supplierBillId: billId },
      include: {
        payment: {
          select: {
            paymentNumber: true,
            paymentDate: true,
            documentStatus: true,
            postingStatus: true,
            bankAccountId: true,
            _count: { select: { releaseSignatures: true } },
          },
        },
      },
      orderBy: { allocationDate: 'asc' },
    });
  }

  /**
   * `projectId` matches a bill coded to the project on its header or on any line — a bill for
   * several projects is coded per line, and each of those projects must see it.
   */
  findAll(
    prisma: TenantPrisma,
    organizationId: string,
    filter: { supplierId?: string; projectId?: string } = {},
  ) {
    return prisma.supplierBill.findMany({
      where: {
        organizationId,
        ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
        ...(filter.projectId ? supplierBillProjectWhere(filter.projectId) : {}),
      },
      include: { supplier: { select: { id: true, code: true, name: true } } },
      orderBy: { billDate: 'desc' },
    });
  }

  /**
   * The LIVE bill already holding this supplier invoice number, if any. Compared on the
   * normalised form (so "INV-0042" and "inv 0042" are the same number). Rejected and cancelled
   * bills no longer hold their number — the partial unique index in migration 20260927120000 —
   * and `excludeBillId` skips the bill being edited.
   */
  findBySupplierInvoiceNumber(
    prisma: TenantPrisma,
    organizationId: string,
    supplierId: string,
    supplierInvoiceNumber: string,
    excludeBillId?: string,
  ) {
    return prisma.supplierBill.findFirst({
      where: {
        organizationId,
        supplierId,
        supplierInvoiceNumberNorm: normalizeSupplierInvoiceNumber(supplierInvoiceNumber),
        documentStatus: { notIn: ['REJECTED', 'CANCELLED'] },
        ...(excludeBillId ? { id: { not: excludeBillId } } : {}),
      },
      select: { id: true, billNumber: true, supplierInvoiceNumber: true },
    });
  }

  async create(prisma: TenantPrisma, data: CreateSupplierBillData) {
    const norm = normalizeSupplierInvoiceNumber(data.supplierInvoiceNumber);
    return prisma.supplierBill.create({
      data: {
        organizationId: data.organizationId,
        supplierId: data.supplierId,
        supplierInvoiceNumber: data.supplierInvoiceNumber,
        supplierInvoiceNumberNorm: norm,
        billDate: data.billDate,
        dueDate: data.dueDate,
        currencyCode: data.currencyCode,
        purchaseOrderId: data.purchaseOrderId ?? null,
        purchaseOrderRevisionId: data.purchaseOrderRevisionId ?? null,
        projectId: data.projectId ?? null,
        departmentId: data.departmentId ?? null,
        subtotal: data.subtotal,
        vatAmount: data.vatAmount,
        totalAmount: data.totalAmount,
        outstandingAmount: data.totalAmount,
        documentStatus: 'DRAFT',
        postingStatus: 'NOT_POSTED',
        createdBy: data.createdBy,
        lines: { create: data.lines },
      },
      include: { lines: true },
    });
  }

  /** Guarded on SUBMITTED: a bill rejected or returned a moment ago is not approved (P2025). */
  approve(prisma: TenantPrisma, id: string, approvedBy: string) {
    return prisma.supplierBill.update({
      where: { id, documentStatus: 'SUBMITTED' },
      data: { documentStatus: 'APPROVED', approvedBy, approvedAt: new Date() },
    });
  }

  markPosted(
    prisma: TenantPrisma,
    id: string,
    journalEntryId: string,
    billNumber: string,
    postedBy: string,
  ) {
    return prisma.supplierBill.update({
      where: { id },
      data: {
        postingStatus: 'POSTED',
        postedJournalEntryId: journalEntryId,
        billNumber,
        postedAt: new Date(),
        postedBy,
      },
    });
  }

  /**
   * Records a failed posting attempt. Never over a POSTED document: when two posts race, the loser
   * fails on the journal's unique key AFTER the winner committed — it must not flip the posted
   * document to FAILED (ADR-045 double-tap finding).
   */
  markPostingFailed(prisma: TenantPrisma, id: string, errorCode: string) {
    return prisma.supplierBill.updateMany({
      where: { id, postingStatus: { not: 'POSTED' } },
      data: { postingStatus: 'FAILED', lastPostingAttemptAt: new Date(), lastPostingErrorCode: errorCode },
    });
  }

  updateOutstandingAmount(prisma: TenantPrisma, id: string, outstandingAmount: Decimal) {
    return prisma.supplierBill.update({ where: { id }, data: { outstandingAmount } });
  }

  // D7 — resolve each bill line's inherited cost-target from the bill's match. The match links every
  // bill line to its PO line; the PO line carries the authoritative projectId/boqNodeId (A3/D7, #148).
  // Org/overhead PO lines carry null → the ACTUAL entry attributes to no project, exactly as the PO
  // COMMITTED did. Returns [] when there is no match (a non-PO bill never reaches the ACTUAL path).
  async findBillLineCostTargets(prisma: TenantPrisma, billId: string): Promise<BillLineCostTarget[]> {
    const match = await prisma.supplierBillMatch.findUnique({
      where: { supplierBillId: billId },
      include: { lines: { include: { purchaseOrderLine: true } } },
    });
    if (!match) return [];
    return match.lines.map((l) => ({
      supplierBillLineId: l.supplierBillLineId,
      purchaseOrderLineId: l.purchaseOrderLineId,
      projectId: l.purchaseOrderLine.projectId,
      boqNodeId: l.purchaseOrderLine.boqNodeId,
      spendCategoryId: l.purchaseOrderLine.spendCategoryId,
      // The exact basis the GRN accrued on, for the quantity this bill line covers.
      accruedBasis: new Decimal(l.billedQuantity.toString()).mul(
        new Decimal(l.poUnitPrice.toString()),
      ),
    }));
  }
}
