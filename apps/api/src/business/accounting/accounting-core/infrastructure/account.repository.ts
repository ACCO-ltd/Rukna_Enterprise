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
}
