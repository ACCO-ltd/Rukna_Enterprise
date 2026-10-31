import { Injectable } from '@nestjs/common';
import type {
  PrismaClient,
  Account,
  AccountVersion,
  NormalBalance,
  AccountClass,
  AccountSubtype,
  AccountStatus,
  ControlPostingPolicy,
  SubledgerType,
} from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export type AccountWithCurrentVersion = Account & { versions: AccountVersion[] };

@Injectable()
export class AccountRepository {
  findByCode(prisma: TenantPrisma, organizationId: string, code: string): Promise<AccountWithCurrentVersion | null> {
    return prisma.account.findUnique({
      where: { organizationId_code: { organizationId, code } },
      include: { versions: { orderBy: { versionNumber: 'desc' } } },
    }) as Promise<AccountWithCurrentVersion | null>;
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<AccountWithCurrentVersion | null> {
    return prisma.account.findFirst({
      where: { id, organizationId },
      include: { versions: { orderBy: { versionNumber: 'desc' } } },
    }) as Promise<AccountWithCurrentVersion | null>;
  }

  findAll(prisma: TenantPrisma, organizationId: string) {
    return prisma.account.findMany({
      where: { organizationId },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
      orderBy: { code: 'asc' },
    });
  }

  findBySubtype(prisma: TenantPrisma, organizationId: string, subtype: AccountSubtype) {
    return prisma.account.findMany({
      where: { organizationId, status: 'ACTIVE' },
      include: {
        versions: {
          where: { accountSubtype: subtype },
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    });
  }

  create(
    prisma: TenantPrisma,
    data: {
      organizationId: string;
      code: string;
      normalBalance: NormalBalance;
      createdBy: string;
      version: {
        versionNumber: number;
        name: string;
        parentAccountId?: string;
        accountClass: AccountClass;
        accountSubtype: AccountSubtype;
        isPostingAllowed: boolean;
        isControlAccount: boolean;
        controlledSubledgerType?: SubledgerType;
        controlPostingPolicy: ControlPostingPolicy;
        effectiveFrom: Date;
        changedBy: string;
      };
    },
  ): Promise<AccountWithCurrentVersion> {
    return prisma.account.create({
      data: {
        organizationId: data.organizationId,
        code: data.code,
        normalBalance: data.normalBalance,
        status: 'ACTIVE',
        createdBy: data.createdBy,
        versions: { create: { ...data.version } },
      },
      include: { versions: true },
    }) as Promise<AccountWithCurrentVersion>;
  }

  addVersion(
    prisma: TenantPrisma,
    accountId: string,
    version: {
      versionNumber: number;
      name: string;
      parentAccountId?: string;
      accountClass: AccountClass;
      accountSubtype: AccountSubtype;
      isPostingAllowed: boolean;
      isControlAccount: boolean;
      controlledSubledgerType?: SubledgerType;
      controlPostingPolicy: ControlPostingPolicy;
      effectiveFrom: Date;
      effectiveTo?: Date;
      changedBy: string;
      changeReason?: string;
    },
  ) {
    return prisma.accountVersion.create({
      data: { accountId, ...version },
    });
  }

  updateStatus(prisma: TenantPrisma, id: string, status: AccountStatus) {
    return prisma.account.update({ where: { id }, data: { status } });
  }

  getEffectiveVersion(prisma: TenantPrisma, accountId: string, date: Date): Promise<AccountVersion | null> {
    return prisma.accountVersion.findFirst({
      where: {
        accountId,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }],
      },
      orderBy: { versionNumber: 'desc' },
    });
  }

  /**
   * GL-C — what depends on an account: its posted entries and balance (debits less credits), the
   * accounts under it, a bank or cash account posting to it, and the set-up that names it.
   */
  async usage(prisma: TenantPrisma, organizationId: string, accountId: string) {
    const [sums, entries, children, bank, profiles, years, templates] = await Promise.all([
      prisma.journalLine.aggregate({
        where: { accountId, entry: { organizationId, status: 'POSTED' } },
        _sum: { debitAmount: true, creditAmount: true },
      }),
      prisma.journalLine.count({ where: { accountId, entry: { organizationId, status: 'POSTED' } } }),
      prisma.account.findMany({
        where: { organizationId, versions: { some: { effectiveTo: null, parentAccountId: accountId } } },
        select: { status: true },
      }),
      prisma.bankAccount.findFirst({ where: { organizationId, glAccountId: accountId, status: { not: 'CLOSED' } }, select: { accountName: true } }),
      prisma.postingProfileVersion.findMany({
        where: { accountId, effectiveTo: null, profile: { organizationId, status: 'ACTIVE' } },
        select: { name: true },
      }),
      prisma.fiscalYear.findMany({ where: { organizationId, retainedEarningsAccountId: accountId, status: { not: 'CLOSED' } }, select: { name: true } }),
      prisma.postingRuleLineTemplate.count({ where: { fixedAccountId: accountId } }),
    ]);
    const debit = Number(sums._sum.debitAmount ?? 0);
    const credit = Number(sums._sum.creditAmount ?? 0);
    return {
      balance: (debit - credit).toFixed(2),
      hasEntries: entries > 0,
      hasChildren: children.length > 0,
      activeChildren: children.filter((c) => c.status === 'ACTIVE').length,
      linkedToBank: !!bank,
      usedBy: [
        ...profiles.map((p) => `posting profile ${p.name}`),
        ...years.map((y) => `fiscal year ${y.name} (retained earnings)`),
        ...(templates > 0 ? ['a posting rule'] : []),
      ],
    };
  }

  /** The account and every heading above it, nearest first. */
  async lineage(prisma: TenantPrisma, organizationId: string, accountId: string): Promise<string[]> {
    const seen: string[] = [];
    let id: string | null = accountId;
    while (id && !seen.includes(id) && seen.length < 50) {
      seen.push(id);
      const current: { parentAccountId: string | null } | null = await prisma.accountVersion.findFirst({
        where: { accountId: id, effectiveTo: null, account: { organizationId } },
        select: { parentAccountId: true },
      });
      id = current?.parentAccountId ?? null;
    }
    return seen;
  }

  /** Case-insensitive: "a-100" and "A-100" are the same code to a person reading a report. */
  findByCodeInsensitive(prisma: TenantPrisma, organizationId: string, code: string) {
    return prisma.account.findFirst({ where: { organizationId, code: { equals: code, mode: 'insensitive' } }, select: { id: true, code: true } });
  }
}
