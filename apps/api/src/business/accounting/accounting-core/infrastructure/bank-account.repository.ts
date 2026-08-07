import { Injectable } from '@nestjs/common';
import type { PrismaClient, BankAccount } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export type BankAccountWithGl = BankAccount & {
  glAccount: { id: string; code: string } | null;
};

@Injectable()
export class BankAccountRepository {
  findAll(prisma: TenantPrisma, organizationId: string): Promise<BankAccountWithGl[]> {
    return prisma.bankAccount.findMany({
      where: { organizationId },
      include: { glAccount: { select: { id: true, code: true } } },
      orderBy: { createdAt: 'asc' },
    }) as Promise<BankAccountWithGl[]>;
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<BankAccountWithGl | null> {
    return prisma.bankAccount.findFirst({
      where: { id, organizationId },
      include: { glAccount: { select: { id: true, code: true } } },
    }) as Promise<BankAccountWithGl | null>;
  }

  findByGlAccount(prisma: TenantPrisma, organizationId: string, glAccountId: string) {
    return prisma.bankAccount.findFirst({
      where: { organizationId, glAccountId },
    });
  }

  create(
    prisma: TenantPrisma,
    data: {
      organizationId: string;
      accountName: string;
      accountNameAr?: string;
      bankName: string;
      accountNumber: string;
      currencyCode: string;
      glAccountId: string;
      allowsReceipts: boolean;
      allowsPayments: boolean;
      treasuryGroupId?: string;
      createdBy: string;
    },
  ) {
    return prisma.bankAccount.create({
      data: { ...data, status: 'ACTIVE' },
    });
  }
}
