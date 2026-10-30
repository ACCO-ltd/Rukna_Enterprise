import { Injectable } from '@nestjs/common';
import type { PrismaClient, BankAccount, BankAccountStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

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
      bankName: string;
      accountNumber: string;
      currencyCode: string;
      glAccountId: string;
      kind?: 'BANK' | 'CASH' | 'MOBILE_WALLET';
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

  /** B-1 — each GL account's posted balance (debit − credit). */
  async bookBalances(prisma: TenantPrisma, organizationId: string, glAccountIds: string[]): Promise<Map<string, Decimal>> {
    if (glAccountIds.length === 0) return new Map();
    const rows = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where: { accountId: { in: glAccountIds }, entry: { organizationId, status: 'POSTED' } },
      _sum: { debitAmount: true, creditAmount: true },
    });
    return new Map(rows.map((r) => [
      r.accountId,
      new Decimal(r._sum.debitAmount?.toString() ?? '0').minus(new Decimal(r._sum.creditAmount?.toString() ?? '0')),
    ]));
  }

  /** B-1 — the end date of each account's latest reconciled statement. */
  async lastReconciled(prisma: TenantPrisma, organizationId: string): Promise<Map<string, Date>> {
    const rows = await prisma.bankStatement.groupBy({
      by: ['bankAccountId'],
      where: { organizationId, status: 'RECONCILED' },
      _max: { statementDate: true },
    });
    return new Map(rows.filter((r) => r._max.statementDate).map((r) => [r.bankAccountId, r._max.statementDate!]));
  }

  /** B-1 — documents raised on the account that have not posted yet (they would post to a closed account). */
  async unpostedDocuments(prisma: TenantPrisma, organizationId: string, bankAccountId: string): Promise<number> {
    const [payments, receipts] = await Promise.all([
      prisma.supplierPayment.count({
        where: { organizationId, bankAccountId, postingStatus: { in: ['NOT_POSTED', 'FAILED'] }, documentStatus: { notIn: ['REJECTED', 'CANCELLED'] } },
      }),
      prisma.paymentReceipt.count({ where: { organizationId, bankAccountId, postingStatus: { in: ['NOT_POSTED', 'FAILED'] } } }),
    ]);
    return payments + receipts;
  }

  update(
    prisma: TenantPrisma,
    id: string,
    data: Partial<{
      accountName: string;
      bankName: string;
      accountNumber: string;
      kind: 'BANK' | 'CASH' | 'MOBILE_WALLET';
      allowsReceipts: boolean;
      allowsPayments: boolean;
    }>,
  ) {
    return prisma.bankAccount.update({ where: { id }, data });
  }

  setStatus(prisma: TenantPrisma, id: string, status: BankAccountStatus) {
    return prisma.bankAccount.update({
      where: { id },
      data: { status, closedAt: status === 'CLOSED' ? new Date() : null },
    });
  }
}
