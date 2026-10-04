import { Injectable } from '@nestjs/common';
import type { PrismaClient, MasterDataStatus } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateSpendCategoryData {
  organizationId: string;
  code: string;
  name: string;
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
    return prisma.spendCategory.findMany({
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

  create(prisma: TenantPrisma, data: CreateSpendCategoryData) {
    return prisma.spendCategory.create({ data });
  }

  setStatus(prisma: TenantPrisma, id: string, status: MasterDataStatus) {
    return prisma.spendCategory.update({ where: { id }, data: { status } });
  }
}
