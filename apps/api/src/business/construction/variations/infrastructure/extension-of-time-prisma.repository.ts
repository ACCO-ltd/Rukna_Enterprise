import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// An EoT with the cited VOs resolved to the refs the read model surfaces.
export type ExtensionOfTimeWithCitedVos = Prisma.ExtensionOfTimeGetPayload<{
  include: { citedVariationOrders: { select: { id: true; reference: true; status: true } } };
}>;

/**
 * ADR-026 CONST-VAR-009 (Variations Phase 4) — infrastructure for the Extension-of-Time command.
 * Prisma lives ONLY here (Clean Architecture). Every read is org-scoped so a caller can never reach
 * another tenant's contract or its extension history.
 */
@Injectable()
export class ExtensionOfTimePrismaRepository {
  /** The contract this EoT would move — org-scoped, with the current end date + status the guard needs. */
  findContract(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.contract.findFirst({
      where: { id: contractId, organizationId },
      select: { id: true, organizationId: true, status: true, expectedEndDate: true },
    });
  }

  /**
   * The cited VOs, org-scoped and constrained to THIS contract — the integrity check that a cited VO
   * belongs to the contract being extended. Returns only ids so the service can diff against the
   * requested set. An empty `ids` returns [].
   */
  findVariationOrdersForContract(
    prisma: TenantPrisma,
    organizationId: string,
    contractId: string,
    ids: string[],
  ) {
    if (ids.length === 0) return Promise.resolve([] as Array<{ id: string }>);
    return prisma.variationOrder.findMany({
      where: { organizationId, contractId, id: { in: ids } },
      select: { id: true },
    });
  }

  /** Create the immutable EoT row + connect the cited VOs, inside the caller's transaction. */
  create(
    prisma: Prisma.TransactionClient,
    data: {
      organizationId: string;
      contractId: string;
      previousEndDate: Date | null;
      newEndDate: Date;
      grantedDays: number | null;
      reason: string;
      grantedBy: string;
      grantedAt: Date;
      citedVariationOrderIds: string[];
    },
  ): Promise<ExtensionOfTimeWithCitedVos> {
    return prisma.extensionOfTime.create({
      data: {
        organizationId: data.organizationId,
        contractId: data.contractId,
        previousEndDate: data.previousEndDate,
        newEndDate: data.newEndDate,
        grantedDays: data.grantedDays,
        reason: data.reason,
        grantedBy: data.grantedBy,
        grantedAt: data.grantedAt,
        citedVariationOrders:
          data.citedVariationOrderIds.length > 0
            ? { connect: data.citedVariationOrderIds.map((id) => ({ id })) }
            : undefined,
      },
      include: {
        citedVariationOrders: { select: { id: true, reference: true, status: true } },
      },
    });
  }

  /** Set the contract's contractual completion date to the EoT's new date, inside the transaction. */
  updateContractEndDate(prisma: Prisma.TransactionClient, contractId: string, newEndDate: Date) {
    return prisma.contract.update({
      where: { id: contractId },
      data: { expectedEndDate: newEndDate },
    });
  }

  /** The EoT history for a contract, newest first. */
  findByContract(
    prisma: TenantPrisma,
    organizationId: string,
    contractId: string,
  ): Promise<ExtensionOfTimeWithCitedVos[]> {
    return prisma.extensionOfTime.findMany({
      where: { organizationId, contractId },
      orderBy: { grantedAt: 'desc' },
      include: {
        citedVariationOrders: { select: { id: true, reference: true, status: true } },
      },
    });
  }
}
