import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * ADR-026 CONST-VAR-007 / OQ-2 (Variations Phase 2) — infrastructure for the Contract-Baseline
 * repoint command. Prisma lives ONLY here (Clean Architecture). Every read is org-scoped so a caller
 * can never repoint another tenant's contract or adopt a version from another project.
 */
@Injectable()
export class AdoptBaselinePrismaRepository {
  /** The contract to repoint — org-scoped, with the current baseline pointer + status the guard needs. */
  findContract(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.contract.findFirst({
      where: { id: contractId, organizationId },
      select: { id: true, organizationId: true, projectId: true, status: true, boqVersionId: true },
    });
  }

  /**
   * The target BOQ version, resolved with its BOQ's project — so the service can verify it is a
   * BASELINED version belonging to THIS contract's project. Returns the version status + project id.
   */
  findVersionWithProject(prisma: TenantPrisma, versionId: string) {
    return prisma.boqVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        status: true,
        versionNumber: true,
        boq: { select: { projectId: true } },
      },
    });
  }

  /** Repoint the Contract Baseline to the adopted version, inside the caller's transaction. */
  updateContractBaseline(
    prisma: Prisma.TransactionClient,
    contractId: string,
    boqVersionId: string,
  ) {
    return prisma.contract.update({
      where: { id: contractId },
      data: { boqVersionId },
    });
  }
}
