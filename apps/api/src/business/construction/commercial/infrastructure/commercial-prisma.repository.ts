import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

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
        deductions: { select: { amount: true } },
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

  /** Posted-or-pending client invoices for a contract, with their posted receipt allocations. */
  findInvoices(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.clientInvoice.findMany({
      where: { organizationId, contractId },
      select: {
        id: true,
        sourceIpcId: true,
        invoiceNumber: true,
        documentStatus: true,
        postingStatus: true,
        totalAmount: true,
        currencyCode: true,
        allocations: {
          where: { postingStatus: 'POSTED' },
          select: { allocatedAmount: true },
        },
      },
    });
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
