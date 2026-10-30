import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

type TenantPrisma = PrismaClient;

/**
 * AP-3 — the payables documents a supplier statement is read from, in a handful of queries; the
 * placing and arithmetic happen in the shared statement domain.
 */
@Injectable()
export class SupplierStatementRepository {
  findSupplier(prisma: TenantPrisma, organizationId: string, supplierId: string) {
    return prisma.supplier.findFirst({ where: { id: supplierId, organizationId }, select: { id: true, name: true, code: true, address: true } });
  }

  /** SS-2 — who the statement is from. */
  findOrganizationName(prisma: TenantPrisma, organizationId: string) {
    return prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  }

  /** SS-2 — what the statement PDF is branded with (the invoice document's identity). */
  findBranding(prisma: TenantPrisma, organizationId: string) {
    return prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, legalAddress: true, taxRegistrationNumber: true, brandColorHex: true, invoiceTemplate: true, logoFileId: true },
    });
  }

  /** SS-3 — who the statement can be sent to on WhatsApp. */
  findSupplierContacts(prisma: TenantPrisma, organizationId: string, supplierId: string) {
    return prisma.supplier.findFirst({
      where: { id: supplierId, organizationId },
      select: { id: true, name: true, contacts: { select: { id: true, name: true, role: true, phone: true, isPrimary: true } } },
    });
  }

  /** Every bill that ever reached the payables book (posted, reversed, or carried in). */
  findBills(prisma: TenantPrisma, organizationId: string, supplierId: string) {
    return prisma.supplierBill.findMany({
      where: { organizationId, supplierId, postingStatus: { in: ['POSTED', 'REVERSED', 'OPENING_BALANCE'] } },
      select: {
        id: true,
        billNumber: true,
        supplierInvoiceNumber: true,
        billDate: true,
        dueDate: true,
        totalAmount: true,
        outstandingAmount: true,
        postingStatus: true,
        documentStatus: true,
        reversalJournalEntryId: true,
        reversedAt: true,
      },
    });
  }

  /** Posted (or posted then reversed) payments. */
  findPayments(prisma: TenantPrisma, organizationId: string, supplierId: string) {
    return prisma.supplierPayment.findMany({
      where: { organizationId, supplierId, postingStatus: { in: ['POSTED', 'REVERSED'] } },
      select: { id: true, paymentNumber: true, bankReference: true, accountingDate: true, totalAmount: true, unallocatedAmount: true, postingStatus: true, updatedAt: true },
    });
  }

  /** Raised, not posted, not rejected or cancelled: the total they will pay. */
  async pendingPaymentsTotal(prisma: TenantPrisma, organizationId: string, supplierId: string) {
    const sum = await prisma.supplierPayment.aggregate({
      where: { organizationId, supplierId, postingStatus: { in: ['NOT_POSTED', 'FAILED'] }, documentStatus: { notIn: ['REJECTED', 'CANCELLED'] } },
      _sum: { totalAmount: true },
    });
    return sum._sum.totalAmount;
  }

  /** ADR-045 — buyer cash applied to this supplier's bills (EVT-AP-008: Dr AP / Cr buyer advance). */
  findBuyerCash(prisma: TenantPrisma, organizationId: string, supplierId: string) {
    return prisma.buyerAdvanceEvidenceAllocation.findMany({
      where: { organizationId, supplierBill: { supplierId }, postingStatus: { in: ['POSTED', 'REVERSED'] } },
      select: {
        id: true,
        supplierBillId: true,
        allocatedAmount: true,
        allocationDate: true,
        createdAt: true,
        postingStatus: true,
        reversalJournalEntryId: true,
        reversedAt: true,
        supplierBill: { select: { billNumber: true, supplierInvoiceNumber: true } },
      },
    });
  }

  /** AP-4 — posted (or posted then reversed) debit notes. */
  findDebitNotes(prisma: TenantPrisma, organizationId: string, supplierId: string) {
    return prisma.supplierDebitNote.findMany({
      where: { organizationId, supplierId },
      select: {
        id: true, supplierBillId: true, debitNoteNumber: true, supplierReference: true, accountingDate: true, amount: true,
        status: true, reversalJournalEntryId: true, reversedAt: true, bill: { select: { billNumber: true, supplierInvoiceNumber: true } },
      },
    });
  }

  /** AP-5 — refunds the supplier paid back (posted, or posted then reversed). */
  findRefunds(prisma: TenantPrisma, organizationId: string, supplierId: string) {
    return prisma.supplierRefund.findMany({
      where: { organizationId, supplierId },
      select: { id: true, supplierPaymentId: true, refundNumber: true, reference: true, refundDate: true, amount: true, status: true, reversalJournalEntryId: true, reversedAt: true },
    });
  }

  /** Accounting dates of journals by id (reversals are dated by their journal). */
  async journalDates(prisma: TenantPrisma, ids: string[]): Promise<Map<string, Date>> {
    if (ids.length === 0) return new Map();
    const rows = await prisma.journalEntry.findMany({ where: { id: { in: ids } }, select: { id: true, accountingDate: true } });
    return new Map(rows.map((r) => [r.id, r.accountingDate]));
  }

  /** A reversed payment's journal is keyed `reversal-<paymentId>`; the payment row keeps no link. */
  async paymentReversalDates(prisma: TenantPrisma, organizationId: string, paymentIds: string[]): Promise<Map<string, Date>> {
    if (paymentIds.length === 0) return new Map();
    const rows = await prisma.journalEntry.findMany({
      where: { organizationId, sourceDocumentType: 'SUPPLIER_PAYMENT', sourceDocumentId: { in: paymentIds.map((id) => `reversal-${id}`) } },
      select: { sourceDocumentId: true, accountingDate: true },
    });
    return new Map(rows.map((r) => [(r.sourceDocumentId ?? '').replace(/^reversal-/, ''), r.accountingDate]));
  }
}
