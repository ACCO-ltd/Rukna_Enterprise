import { Injectable } from '@nestjs/common';
import type { PrismaClient, MasterDataStatus } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateMaterialCategoryData {
  organizationId: string;
  code: string;
  name: string;
  parentId?: string;
}

@Injectable()
export class MaterialCategoryRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.materialCategory.findFirst({
      where: { id, organizationId },
      include: { children: { where: { status: 'ACTIVE' }, orderBy: { code: 'asc' } } },
    });
  }

  findByCode(prisma: TenantPrisma, organizationId: string, code: string) {
    return prisma.materialCategory.findUnique({
      where: { organizationId_code: { organizationId, code } },
    });
  }

  findAll(prisma: TenantPrisma, organizationId: string, status?: MasterDataStatus) {
    return prisma.materialCategory.findMany({
      where: { organizationId, ...(status ? { status } : {}), parentId: null },
      include: { children: { where: { status: 'ACTIVE' }, orderBy: { code: 'asc' } } },
      orderBy: { code: 'asc' },
    });
  }

  create(prisma: TenantPrisma, data: CreateMaterialCategoryData) {
    return prisma.materialCategory.create({ data });
  }

  setStatus(prisma: TenantPrisma, id: string, status: MasterDataStatus) {
    return prisma.materialCategory.update({ where: { id }, data: { status } });
  }
}
