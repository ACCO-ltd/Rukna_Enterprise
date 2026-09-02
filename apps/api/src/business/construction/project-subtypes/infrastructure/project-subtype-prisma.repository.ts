import { Injectable } from '@nestjs/common';
import type { PrismaClient, ProjectCategory, MasterDataStatus } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class ProjectSubtypeRepository {
  list(
    prisma: TenantPrisma,
    organizationId: string,
    filter: { category?: ProjectCategory; activeOnly?: boolean } = {},
  ) {
    return prisma.projectSubtype.findMany({
      where: {
        organizationId,
        ...(filter.category ? { category: filter.category } : {}),
        ...(filter.activeOnly ? { status: 'ACTIVE' } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.projectSubtype.findFirst({ where: { id, organizationId } });
  }

  findByCategoryAndName(
    prisma: TenantPrisma,
    organizationId: string,
    category: ProjectCategory,
    name: string,
  ) {
    return prisma.projectSubtype.findFirst({ where: { organizationId, category, name } });
  }

  create(
    prisma: TenantPrisma,
    data: { organizationId: string; category: ProjectCategory; name: string },
  ) {
    return prisma.projectSubtype.create({ data });
  }

  updateStatus(prisma: TenantPrisma, id: string, status: MasterDataStatus) {
    return prisma.projectSubtype.update({ where: { id }, data: { status } });
  }
}
