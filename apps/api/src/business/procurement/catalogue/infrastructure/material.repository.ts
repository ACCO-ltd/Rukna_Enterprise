import { Injectable } from '@nestjs/common';
import type { PrismaClient, MaterialStatus } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateMaterialData {
  organizationId: string;
  code: string;
  name: string;
  description?: string;
  materialCategoryId: string;
  defaultSpendCategoryId?: string;
  baseUnitOfMeasureId: string;
}

@Injectable()
export class MaterialRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.material.findFirst({
      where: { id, organizationId },
      include: {
        materialCategory: true,
        defaultSpendCategory: true,
        baseUom: true,
      },
    });
  }

  findByCode(prisma: TenantPrisma, organizationId: string, code: string) {
    return prisma.material.findUnique({
      where: { organizationId_code: { organizationId, code } },
    });
  }

  findAll(
    prisma: TenantPrisma,
    organizationId: string,
    filters?: { status?: MaterialStatus; materialCategoryId?: string; spendCategoryId?: string },
  ) {
    return prisma.material.findMany({
      where: {
        organizationId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.materialCategoryId ? { materialCategoryId: filters.materialCategoryId } : {}),
        ...(filters?.spendCategoryId ? { defaultSpendCategoryId: filters.spendCategoryId } : {}),
      },
      include: { materialCategory: true, defaultSpendCategory: true, baseUom: true },
      orderBy: { code: 'asc' },
    });
  }

  create(prisma: TenantPrisma, data: CreateMaterialData) {
    return prisma.material.create({
      data,
      include: { materialCategory: true, defaultSpendCategory: true, baseUom: true },
    });
  }

  setStatus(prisma: TenantPrisma, id: string, status: MaterialStatus) {
    return prisma.material.update({ where: { id }, data: { status } });
  }
}
