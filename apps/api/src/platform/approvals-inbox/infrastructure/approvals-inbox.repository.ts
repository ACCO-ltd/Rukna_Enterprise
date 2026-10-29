import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** Each queue is bounded; the inbox is a to-do list, not a report. */
const LIMIT = 100;
/** `undefined` = every project (bypass); otherwise only these, plus documents with no project. */
type ProjectScope = string[] | undefined;
const projectWhere = (ids: ProjectScope) => (ids === undefined ? {} : { projectId: { in: ids } });
const optionalProjectWhere = (ids: ProjectScope) =>
  ids === undefined ? {} : { OR: [{ projectId: null }, { projectId: { in: ids } }] };

/**
 * Read-only queues for the Approvals inbox (Step 3, ADR-049): documents sitting in the state a
 * decision moves them out of. Reads tables owned by other modules through Prisma only — it imports
 * none of their services (ARCH-BOUNDARY-001). The service decides who may see which queue.
 */
@Injectable()
export class ApprovalsInboxRepository {
  /** ADR-046 §8 — draft invoices at or above the organisation's invoice approval amount. */
  async invoicesAwaitingApproval(prisma: TenantPrisma, organizationId: string, projects: ProjectScope) {
    const policy = await prisma.postingPolicy.findUnique({ where: { organizationId }, select: { invoiceApprovalAbove: true } });
    if (!policy?.invoiceApprovalAbove) return [];
    return prisma.clientInvoice.findMany({
      where: {
        organizationId,
        documentStatus: 'DRAFT',
        postingStatus: 'NOT_POSTED',
        totalAmount: { gte: policy.invoiceApprovalAbove },
        ...optionalProjectWhere(projects),
      },
      orderBy: { createdAt: 'asc' },
      take: LIMIT,
      select: {
        id: true,
        invoiceDate: true,
        totalAmount: true,
        currencyCode: true,
        projectId: true,
        createdBy: true,
        createdAt: true,
        client: { select: { name: true } },
      },
    });
  }

  /** AR-4 — write-offs above the organisation's limit, waiting for a second person. */
  writeOffsAwaitingApproval(prisma: TenantPrisma, organizationId: string) {
    return prisma.receivableWriteOff.findMany({
      where: { organizationId, status: 'PENDING_APPROVAL' },
      orderBy: { requestedAt: 'asc' },
      take: LIMIT,
      select: {
        id: true,
        invoiceId: true,
        amount: true,
        reason: true,
        requestedBy: true,
        requestedAt: true,
        invoice: { select: { invoiceNumber: true, currencyCode: true, projectId: true, client: { select: { name: true } } } },
      },
    });
  }

  /** AR-5 — refunds above the payment limit, waiting for a second person. */
  refundsAwaitingApproval(prisma: TenantPrisma, organizationId: string) {
    return prisma.clientRefund.findMany({
      where: { organizationId, status: 'PENDING_APPROVAL' },
      orderBy: { requestedAt: 'asc' },
      take: LIMIT,
      select: {
        id: true,
        receiptId: true,
        amount: true,
        reason: true,
        requestedBy: true,
        requestedAt: true,
        receipt: { select: { receiptNumber: true, currencyCode: true, client: { select: { name: true } } } },
      },
    });
  }

  submittedJournals(prisma: TenantPrisma, organizationId: string) {
    return prisma.journalEntry.findMany({
      where: { organizationId, status: 'SUBMITTED' },
      orderBy: { submittedAt: 'asc' },
      take: LIMIT,
      select: {
        id: true,
        journalNumber: true,
        accountingDate: true,
        description: true,
        currencyCode: true,
        createdBy: true,
        submittedBy: true,
        submittedAt: true,
        createdAt: true,
        lines: { select: { debitAmount: true } },
      },
    });
  }

  submittedBills(prisma: TenantPrisma, organizationId: string, projects: ProjectScope) {
    return prisma.supplierBill.findMany({
      where: { organizationId, documentStatus: 'SUBMITTED', ...optionalProjectWhere(projects) },
      orderBy: { updatedAt: 'asc' },
      take: LIMIT,
      select: {
        id: true,
        billNumber: true,
        supplierInvoiceNumber: true,
        totalAmount: true,
        currencyCode: true,
        purchaseOrderId: true,
        projectId: true,
        createdBy: true,
        updatedAt: true,
        supplier: { select: { name: true } },
      },
    });
  }

  /** Who received goods on these POs — they may not approve that PO's bill (ADR-022). */
  async goodsReceivers(prisma: TenantPrisma, organizationId: string, purchaseOrderIds: string[]) {
    if (purchaseOrderIds.length === 0) return new Map<string, Set<string>>();
    const receipts = await prisma.goodsReceiptNote.findMany({
      where: { organizationId, purchaseOrderId: { in: purchaseOrderIds } },
      select: { purchaseOrderId: true, createdBy: true },
    });
    const map = new Map<string, Set<string>>();
    for (const r of receipts) {
      if (!r.purchaseOrderId) continue;
      map.set(r.purchaseOrderId, (map.get(r.purchaseOrderId) ?? new Set()).add(r.createdBy));
    }
    return map;
  }

  draftPayments(prisma: TenantPrisma, organizationId: string) {
    return prisma.supplierPayment.findMany({
      where: { organizationId, documentStatus: 'DRAFT' },
      orderBy: { createdAt: 'asc' },
      take: LIMIT,
      select: {
        id: true,
        paymentNumber: true,
        paymentDate: true,
        totalAmount: true,
        currencyCode: true,
        createdBy: true,
        createdAt: true,
        supplier: { select: { name: true } },
        // Whoever approved a bill this payment settles may not approve the payment (ADR-022).
        allocations: { select: { bill: { select: { approvedBy: true } } } },
      },
    });
  }

  quotationsAwaitingDecision(prisma: TenantPrisma, organizationId: string, projects: ProjectScope) {
    return prisma.quotationRequest.findMany({
      where: { organizationId, status: 'AWAITING_DECISION', ...optionalProjectWhere(projects) },
      orderBy: { updatedAt: 'asc' },
      take: LIMIT,
      select: {
        id: true,
        number: true,
        projectId: true,
        createdBy: true,
        updatedAt: true,
        materialRequest: { select: { mrNumber: true, title: true, requestedBy: true } },
        // Everyone who touched the evidence is barred from choosing (ADR-044 §6).
        quotes: { select: { uploadedBy: true, withdrawnBy: true, photos: { select: { uploadedBy: true } } } },
      },
    });
  }

  submittedMaterialRequests(prisma: TenantPrisma, organizationId: string, projects: ProjectScope) {
    return prisma.materialRequest.findMany({
      where: { organizationId, status: 'SUBMITTED', ...optionalProjectWhere(projects) },
      orderBy: { updatedAt: 'asc' },
      take: LIMIT,
      select: { id: true, mrNumber: true, title: true, projectId: true, requestedBy: true, updatedAt: true },
    });
  }

  submittedProgressReports(prisma: TenantPrisma, organizationId: string, projects: ProjectScope) {
    return prisma.dailyProgressReport.findMany({
      where: { organizationId, status: 'SUBMITTED', ...projectWhere(projects) },
      orderBy: { submittedAt: 'asc' },
      take: LIMIT,
      select: { id: true, reportDate: true, projectId: true, preparedBy: true, submittedBy: true, submittedAt: true, createdAt: true },
    });
  }

  /** Pending governed approvals whose current step needs one of `roles` (ADR-011 engine). */
  async pendingWorkflowSteps(prisma: TenantPrisma, organizationId: string, roles: string[]) {
    if (roles.length === 0) return [];
    return prisma.approvalInstance.findMany({
      where: {
        status: 'PENDING',
        definition: { organizationId, steps: { some: { roleRequired: { in: roles } } } },
      },
      orderBy: { updatedAt: 'asc' },
      take: LIMIT,
      select: {
        id: true,
        transactionType: true,
        transactionId: true,
        currentStepOrder: true,
        evaluatedAmount: true,
        initiatedBy: true,
        updatedAt: true,
        definition: { select: { name: true, steps: { select: { stepOrder: true, roleRequired: true } } } },
      },
    });
  }

  async userNames(prisma: TenantPrisma, ids: string[]) {
    if (ids.length === 0) return [];
    return prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
  }

  async projectNames(prisma: TenantPrisma, organizationId: string, ids: string[]) {
    if (ids.length === 0) return [];
    return prisma.project.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, name: true } });
  }
}
