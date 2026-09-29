import { Injectable } from '@nestjs/common';
import type { PrismaClient, MasterDataStatus } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateUomData {
  organizationId: string;
  code: string;
  name: string;
  symbol: string;
}

@Injectable()
export class UomRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.unitOfMeasure.findFirst({ where: { id, organizationId } });
  }

  findByCode(prisma: TenantPrisma, organizationId: string, code: string) {
    return prisma.unitOfMeasure.findUnique({
      where: { organizationId_code: { organizationId, code } },
    });
  }

  findAll(prisma: TenantPrisma, organizationId: string, status?: MasterDataStatus) {
    return prisma.unitOfMeasure.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { code: 'asc' },
    });
  }

  /** The lookup projection: code, name and symbol only, ordered by code. */
  findLookup(prisma: TenantPrisma, organizationId: string, status: MasterDataStatus) {
    return prisma.unitOfMeasure.findMany({
      where: { organizationId, status },
      select: { code: true, name: true, symbol: true },
      orderBy: { code: 'asc' },
    });
  }

  create(prisma: TenantPrisma, data: CreateUomData) {
    return prisma.unitOfMeasure.create({ data });
  }

  setStatus(prisma: TenantPrisma, id: string, status: MasterDataStatus) {
    return prisma.unitOfMeasure.update({ where: { id }, data: { status } });
  }
}
