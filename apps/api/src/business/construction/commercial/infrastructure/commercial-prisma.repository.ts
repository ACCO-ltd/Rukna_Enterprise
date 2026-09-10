import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Read-only aggregation for the Commercial workspace. Construction reads AR data
 * (ClientInvoice, ClientReceiptAllocation) — construction → accounting, allowed by
 * ARCH-BOUNDARY-001. Everything is set-based: one query per collection, no N+1.
 */
@Injectable()
export class CommercialPrismaRepository {
  /** The effective (non-terminal) main client contract for a project, with its terms. */
  findMainContract(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.contract.findFirst({
      where: {
        organizationId,
        projectId,
        contractKind: 'CLIENT_CONTRACT',
        status: { notIn: ['CANCELLED', 'TERMINATED'] as never[] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { id: true, name: true } },
        retentionTerms: true,
        advanceTerms: true,
        guarantees: { orderBy: { expiryDate: 'asc' } },
        milestones: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  /**
   * The version number behind `Contract.boqVersionId`.
   *
   * A separate lookup because `boqVersionId` is a bare column with no Prisma relation — the
   * BOQ is its own aggregate and the contract references it by id rather than owning it. One
   * extra query beats declaring a relation the domain model does not have.
   */
  async findBoqVersionNumber(prisma: TenantPrisma, boqVersionId: string): Promise<number | null> {
    const version = await prisma.boqVersion.findUnique({
      where: { id: boqVersionId },
      select: { versionNumber: true },
    });
    return version?.versionNumber ?? null;
  }

  /** All effective certificates for a contract — the only ones that count (CONST-COM-003). */
  findEffectiveCertificates(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.interimPaymentCertificate.findMany({
      where: {
        organizationId,
        isEffective: true,
        application: { contractId },
      },
      select: {
        id: true,
        applicationId: true,
        certifiedTotal: true,
        currency: true,
        // `deductionType` as well as the amount: retention held and advance recovered are the
        // RETENTION / ADVANCE_RECOVERY slices of this same set, and deriving them here means
        // they can never disagree with the certified-net figure computed beside them.
        deductions: { select: { amount: true, deductionType: true } },
      },
    });
  }

  /** All IPAs for a contract with their certificates (effective + superseded counts). */
  findApplicationsWithCertificates(
    prisma: TenantPrisma,
    organizationId: string,
    contractId: string,
  ) {
    return prisma.interimPaymentApplication.findMany({
      where: { organizationId, contractId },
      orderBy: [{ applicationNumber: 'asc' }, { createdAt: 'asc' }],
      include: {
        items: { select: { periodAmount: true } },
        certificates: {
          select: {
            id: true,
            status: true,
            isEffective: true,
            certifiedTotal: true,
            deductions: { select: { amount: true } },
          },
        },
      },
    });
  }

  /**
   * How many applications have reached the client.
   *
   * DRAFT and PENDING_INTERNAL_APPROVAL are internal working states — counting them would
   * tell a commercial manager they have submitted more than they have.
   */
  countSubmittedApplications(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.interimPaymentApplication.count({
      where: {
        organizationId,
        contractId,
        status: { in: ['APPROVED_FOR_SUBMISSION', 'SUBMITTED'] as never[] },
      },
    });
  }

  /** ADR-023: the payment-schedule installments for a MILESTONE contract, in plan order. */
  findPaymentInstallments(prisma: TenantPrisma, contractId: string) {
    return prisma.contractPaymentInstallment.findMany({
      where: { contractId },
      orderBy: { sortOrder: 'asc' },
      // CONST-COM-011: the linked programme milestone is carried so the read model can show
      // whether the installment's evidence gate is satisfied, and the UI can block invoicing
      // when the milestone is not yet verified.
      include: {
        programmeMilestone: {
          select: { id: true, code: true, name: true, status: true },
        },
      },
    });
  }

  /** Posted-or-pending client invoices for a contract, with their posted receipt allocations. */
  findInvoices(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.clientInvoice.findMany({
      where: { organizationId, contractId },
      select: {
        id: true,
        sourceIpcId: true,
        sourceInstallmentId: true,
        invoiceNumber: true,
        documentStatus: true,
        postingStatus: true,
        totalAmount: true,
        // Carried so the Receivables panel can list what is still owed and when it was due,
        // without a second round trip. `outstandingAmount` is maintained by the AR allocation
        // path — it is the settlement truth ADR-017 nominates.
        outstandingAmount: true,
        invoiceDate: true,
        dueDate: true,
        currencyCode: true,
        allocations: {
          where: { postingStatus: 'POSTED' },
          select: { allocatedAmount: true },
        },
      },
    });
  }

  /**
   * Every client invoice raised under a contract, with the detail Billing & Collection needs:
   * the tax split, the settlement balance, the source document that produced it, and the posted
   * allocations behind what has been collected.
   *
   * Deliberately separate from `findInvoices` (the narrow summary read). Widening that one would
   * have made every summary request carry allocation ids and installment names it never uses.
   */
  findInvoicesForBilling(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.clientInvoice.findMany({
      where: { organizationId, contractId },
      orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        currencyCode: true,
        subtotal: true,
        vatAmount: true,
        totalAmount: true,
        outstandingAmount: true,
        documentStatus: true,
        postingStatus: true,
        // The mutually-exclusive provenance links (ADR-023 installment/IPC; ADR-029 R-4 separate
        // charge). Names, not ids, are what a reader recognises, so each carries the human reference
        // of its source document.
        sourceInstallmentId: true,
        sourceInstallment: { select: { id: true, name: true, sortOrder: true } },
        sourceIpcId: true,
        sourceIpc: {
          select: {
            id: true,
            application: { select: { id: true, applicationRef: true, applicationNumber: true } },
          },
        },
        // ADR-029 R-4 — the SEPARATE_CHARGE BOQ leaf a one-off invoice bills; its code/description is
        // the human reference the read model surfaces.
        sourceBoqNodeId: true,
        sourceBoqNode: { select: { id: true, code: true, description: true } },
        allocations: {
          where: { postingStatus: 'POSTED' },
          orderBy: { allocationDate: 'desc' },
          select: {
            id: true,
            allocatedAmount: true,
            allocationDate: true,
            paymentReceiptId: true,
          },
        },
      },
    });
  }

  /**
   * The receipts that have actually landed against this contract.
   *
   * A `PaymentReceipt` belongs to a client, not a project — only an allocation ties one to a
   * contract. So "this project's receipts" is exactly "receipts with a posted allocation against
   * an invoice of this contract", and saying that in the query is more honest than filtering by
   * client and hoping the money was for this job.
   */
  findReceiptsForContract(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.paymentReceipt.findMany({
      where: {
        organizationId,
        clientAllocations: {
          some: { postingStatus: 'POSTED', invoice: { contractId } },
        },
      },
      orderBy: { receiptDate: 'desc' },
      select: {
        id: true,
        receiptDate: true,
        currencyCode: true,
        totalAmount: true,
        allocatedAmount: true,
        unallocatedAmount: true,
        paymentMethod: true,
        reference: true,
        bankReference: true,
        postingStatus: true,
        clientAllocations: {
          where: { postingStatus: 'POSTED' },
          orderBy: { allocationDate: 'desc' },
          select: {
            id: true,
            allocatedAmount: true,
            allocationDate: true,
            clientInvoiceId: true,
            invoice: { select: { id: true, invoiceNumber: true, contractId: true } },
          },
        },
      },
    });
  }

  /**
   * Unapplied cash sitting on this client's posted receipts.
   *
   * Client-scoped on purpose and reported as such: an unallocated receipt has not been
   * attributed to any contract, which is the whole reason it needs allocating. Scoping it to a
   * project would mean inventing an attribution the data does not carry.
   */
  async sumClientUnappliedReceipts(
    prisma: TenantPrisma,
    organizationId: string,
    clientId: string,
  ): Promise<Decimal> {
    const result = await prisma.paymentReceipt.aggregate({
      where: { organizationId, clientId, postingStatus: 'POSTED' },
      _sum: { unallocatedAmount: true },
    });
    return new Decimal(result._sum.unallocatedAmount?.toString() ?? 0);
  }

  /**
   * Recent commercial audit activity. Child mutations are audited by child id (CONST-COM-005),
   * so the caller passes the full set of relevant resource ids (contract + guarantees +
   * advance terms + milestones + certificates) gathered from the already-loaded aggregate.
   */
  async findRecentActivity(prisma: TenantPrisma, organizationId: string, resourceIds: string[]) {
    if (resourceIds.length === 0) return [];
    return prisma.auditLog.findMany({
      where: {
        orgId: organizationId,
        resource: {
          in: [
            'Contract',
            'ContractGuarantee',
            'ContractAdvanceTerm',
            'ContractRetentionTerms',
            'ContractMilestone',
            'InterimPaymentCertificate',
            // The settlement half of the story. Without these the feed reports certification
            // and contract terms and then falls silent exactly where a commercial manager is
            // watching — an invoice posting, a receipt landing against it.
            'InterimPaymentApplication',
            'ClientInvoice',
            'PaymentReceipt',
            'ClientReceiptAllocation',
          ],
        },
        resourceId: { in: resourceIds },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        action: true,
        sourceCommand: true,
        createdAt: true,
        resourceId: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }
}
