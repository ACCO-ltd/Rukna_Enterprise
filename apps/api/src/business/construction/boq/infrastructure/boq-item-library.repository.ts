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
