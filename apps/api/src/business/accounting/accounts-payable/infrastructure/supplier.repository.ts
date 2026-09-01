import { Injectable } from '@nestjs/common';
import type { PrismaClient, SupplierStatus } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateSupplierData {
  organizationId: string;
  code: string;
  name: string;
  taxNumber?: string;
  defaultCurrency?: string;
  paymentTermsDays?: number;
  createdBy?: string;
}

// A15 (D8): master-data corrections only. `code` (identity) and `status` are intentionally
// absent — they are not editable through supplier master-data editing.
export interface UpdateSupplierData {
  name?: string;
  taxNumber?: string;
  defaultCurrency?: string;
  paymentTermsDays?: number;
  address?: string;
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

  // A15: identity (`code`) and `status` are not in UpdateSupplierData, so they can never be
  // written here. Caller resolves + org-scopes the supplier by id before this runs.
  update(prisma: TenantPrisma, id: string, data: UpdateSupplierData) {
    return prisma.supplier.update({ where: { id }, data });
  }
}
