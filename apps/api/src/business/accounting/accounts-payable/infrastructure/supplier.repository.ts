import { Injectable } from '@nestjs/common';
import type { PrismaClient, SupplierStatus } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateSupplierData {
  organizationId: string;
  code: string;
  name: string;
  nameAr?: string;
  taxNumber?: string;
  defaultCurrency?: string;
  paymentTermsDays?: number;
}

@Injectable()
export class SupplierRepository {
  findAll(prisma: TenantPrisma, organizationId: string, status?: SupplierStatus) {
    return prisma.supplier.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.supplier.findFirst({ where: { id, organizationId } });
  }

  findByCode(prisma: TenantPrisma, organizationId: string, code: string) {
    return prisma.supplier.findFirst({ where: { organizationId, code } });
  }

  create(prisma: TenantPrisma, data: CreateSupplierData) {
    return prisma.supplier.create({ data });
  }
}
