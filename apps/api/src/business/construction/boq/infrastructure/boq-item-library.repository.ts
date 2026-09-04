import { Injectable } from '@nestjs/common';
import type { PrismaClient, MeasurementMethod, PricingBasis } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface CreateBoqItemData {
  organizationId: string;
  code: string;
  description: string;
  defaultUnit?: string;
  measurementMethod?: MeasurementMethod;
  pricingBasis?: PricingBasis;
  category?: string;
  createdBy: string;
}

/** One library row synthesised from an imported leaf. `lastUsedRate` is a decimal string. */
export interface ImportLibraryItem {
  organizationId: string;
  code: string;
  description: string;
  defaultUnit?: string;
  lastUsedRate?: string;
  lastUsedProjectId?: string;
  createdBy: string;
}

/** ADR-020 CONST-BOQ-020 — persistence for the reusable BOQ work-item catalogue. */
@Injectable()
export class BoqItemLibraryRepository {
  search(prisma: TenantPrisma, organizationId: string, query?: string) {
    const q = query?.trim();
    return prisma.boqItemLibrary.findMany({
      where: {
        organizationId,
        active: true,
        ...(q
          ? {
              OR: [
                { code: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ code: 'asc' }],
      take: 50,
    });
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.boqItemLibrary.findFirst({ where: { id, organizationId } });
  }

  findByCode(prisma: TenantPrisma, organizationId: string, code: string) {
    return prisma.boqItemLibrary.findFirst({ where: { organizationId, code } });
  }

  create(prisma: TenantPrisma, data: CreateBoqItemData) {
    return prisma.boqItemLibrary.create({ data });
  }

  /** Every item in the org — code + description + active — for import de-duplication. */
  findAllForDedup(prisma: TenantPrisma, organizationId: string) {
    return prisma.boqItemLibrary.findMany({
      where: { organizationId },
      select: { code: true, description: true, active: true },
    });
  }

  /**
   * Bulk-adds items an import chose to save (Q7). Codes are generated + de-duplicated by the
   * caller; the seeded `lastUsedRate` is assistance only (CONST-BOQ-021), never authoritative.
   */
  async createManyFromImport(prisma: TenantPrisma, data: ImportLibraryItem[]): Promise<number> {
    if (data.length === 0) return 0;
    const result = await prisma.boqItemLibrary.createMany({ data });
    return result.count;
  }

  // CONST-BOQ-021: the last-used rate is assistance only. Recorded on use, never authoritative.
  recordUsage(
    prisma: TenantPrisma,
    id: string,
    data: { lastUsedRate: Decimal; lastUsedProjectId?: string },
  ) {
    return prisma.boqItemLibrary.update({
      where: { id },
      data: {
        lastUsedRate: data.lastUsedRate,
        lastUsedAt: new Date(),
        lastUsedProjectId: data.lastUsedProjectId ?? null,
      },
    });
  }
}
