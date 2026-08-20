import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class DistrictRepository {
  list(prisma: TenantPrisma, organizationId: string, activeOnly: boolean) {
    return prisma.district.findMany({
      where: { organizationId, ...(activeOnly ? { active: true } : {}) },
      orderBy: { code: 'asc' },
    });
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.district.findFirst({ where: { id, organizationId } });
  }

  findByCode(prisma: TenantPrisma, organizationId: string, code: string) {
    return prisma.district.findFirst({ where: { organizationId, code } });
  }

  create(prisma: TenantPrisma, data: { organizationId: string; code: string; name: string }) {
    return prisma.district.create({ data });
  }

  update(
    prisma: TenantPrisma,
    id: string,
    data: { name?: string; active?: boolean },
  ) {
    return prisma.district.update({ where: { id }, data });
  }
}
