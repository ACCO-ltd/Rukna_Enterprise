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

  /**
   * Root categories with their children. ACTIVE (default): active roots, active children — the
   * picker view, unchanged. INACTIVE: roots that are inactive or have an inactive child, with
   * their inactive children. ALL: every root with every child. Each row carries its own status.
   */
  findAll(prisma: TenantPrisma, organizationId: string, filter: 'ACTIVE' | 'INACTIVE' | 'ALL' = 'ACTIVE') {
    const where =
      filter === 'ALL'
        ? { organizationId, parentId: null }
        : filter === 'ACTIVE'
          ? { organizationId, parentId: null, status: 'ACTIVE' as MasterDataStatus }
          : {
              organizationId,
              parentId: null,
              OR: [
                { status: 'INACTIVE' as MasterDataStatus },
                { children: { some: { status: 'INACTIVE' as MasterDataStatus } } },
              ],
            };
    return prisma.materialCategory.findMany({
      where,
      include: {
        children: {
          ...(filter === 'ALL' ? {} : { where: { status: filter as MasterDataStatus } }),
          orderBy: { code: 'asc' },
        },
      },
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
