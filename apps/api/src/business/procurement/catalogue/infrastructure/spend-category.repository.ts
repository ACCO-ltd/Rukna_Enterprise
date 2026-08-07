import { Injectable } from '@nestjs/common';
import type { PrismaClient, MasterDataStatus } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateSpendCategoryData {
  organizationId: string;
  code: string;
  name: string;
  nameAr?: string;
  parentId?: string;
}

@Injectable()
export class SpendCategoryRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.spendCategory.findFirst({
      where: { id, organizationId },
      include: { children: { where: { status: 'ACTIVE' }, orderBy: { code: 'asc' } } },
    });
  }

  findByCode(prisma: TenantPrisma, organizationId: string, code: string) {
    return prisma.spendCategory.findUnique({
      where: { organizationId_code: { organizationId, code } },
    });
  }

  findAll(prisma: TenantPrisma, organizationId: string, status?: MasterDataStatus) {
    return prisma.spendCategory.findMany({
      where: { organizationId, ...(status ? { status } : {}), parentId: null },
      include: { children: { where: { status: 'ACTIVE' }, orderBy: { code: 'asc' } } },
      orderBy: { code: 'asc' },
    });
  }

  create(prisma: TenantPrisma, data: CreateSpendCategoryData) {
    return prisma.spendCategory.create({ data });
  }

  setStatus(prisma: TenantPrisma, id: string, status: MasterDataStatus) {
    return prisma.spendCategory.update({ where: { id }, data: { status } });
  }
}
