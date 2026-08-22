import { Injectable } from '@nestjs/common';
import type { PrismaClient, BankAccountSignatory } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * ADR-022 CONST-DOA-005 — authorized bank signatories. The presence of ≥1 active signatory on an
 * account is what puts payments from it under release dual-control (see SupplierPaymentService).
 */
@Injectable()
export class BankAccountSignatoryRepository {
  listActive(prisma: TenantPrisma, bankAccountId: string): Promise<BankAccountSignatory[]> {
    return prisma.bankAccountSignatory.findMany({
      where: { bankAccountId, isActive: true, removedAt: null },
      orderBy: { addedAt: 'asc' },
    });
  }

  findActive(prisma: TenantPrisma, bankAccountId: string, userId: string) {
    return prisma.bankAccountSignatory.findFirst({
      where: { bankAccountId, userId, isActive: true, removedAt: null },
    });
  }

  countActive(prisma: TenantPrisma, bankAccountId: string): Promise<number> {
    return prisma.bankAccountSignatory.count({
      where: { bankAccountId, isActive: true, removedAt: null },
    });
  }

  add(
    prisma: TenantPrisma,
    data: { organizationId: string; bankAccountId: string; userId: string; addedBy: string },
  ) {
    // Re-adding a previously removed signatory reactivates the same row.
    return prisma.bankAccountSignatory.upsert({
      where: { bankAccountId_userId: { bankAccountId: data.bankAccountId, userId: data.userId } },
      create: { ...data, isActive: true },
      update: { isActive: true, removedAt: null, addedBy: data.addedBy },
    });
  }

  deactivate(prisma: TenantPrisma, bankAccountId: string, userId: string) {
    return prisma.bankAccountSignatory.updateMany({
      where: { bankAccountId, userId, isActive: true },
      data: { isActive: false, removedAt: new Date() },
    });
  }
}
