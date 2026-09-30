import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient, PostingProfile, PostingProfileVersion } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export type PostingProfileWithVersions = PostingProfile & { versions: PostingProfileVersion[] };

/** The current version of an account — what a profile target is validated against. */
export interface ProfileTargetAccount {
  id: string;
  code: string;
  status: string;
  name: string;
  accountClass: string;
  isPostingAllowed: boolean;
}

@Injectable()
export class PostingProfileRepository {
  findAll(prisma: TenantPrisma, organizationId: string, status?: 'ACTIVE' | 'INACTIVE'): Promise<PostingProfileWithVersions[]> {
    return prisma.postingProfile.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      include: { versions: { orderBy: [{ effectiveFrom: 'desc' }, { versionNumber: 'desc' }] } },
      orderBy: { code: 'asc' },
    });
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<PostingProfileWithVersions | null> {
    return prisma.postingProfile.findFirst({
      where: { id, organizationId },
      include: { versions: { orderBy: [{ effectiveFrom: 'desc' }, { versionNumber: 'desc' }] } },
    });
  }

  findByCode(prisma: TenantPrisma, organizationId: string, code: string) {
    return prisma.postingProfile.findUnique({ where: { organizationId_code: { organizationId, code } } });
  }

  async findAccountByCode(prisma: TenantPrisma, organizationId: string, code: string): Promise<ProfileTargetAccount | null> {
    const account = await prisma.account.findUnique({
      where: { organizationId_code: { organizationId, code } },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    const v = account?.versions[0];
    if (!account || !v) return null;
    return {
      id: account.id,
      code: account.code,
      status: account.status,
      name: v.name,
      accountClass: v.accountClass,
      isPostingAllowed: v.isPostingAllowed,
    };
  }

  /** code + current name for each account id (profiles reference accounts by id only). */
  async findAccountLabels(prisma: TenantPrisma, organizationId: string, ids: string[]) {
    if (ids.length === 0) return new Map<string, { code: string; name: string; accountClass: string }>();
    const accounts = await prisma.account.findMany({
      where: { organizationId, id: { in: ids } },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    return new Map(
      accounts.map((a) => [a.id, { code: a.code, name: a.versions[0]?.name ?? a.code, accountClass: a.versions[0]?.accountClass ?? '' }]),
    );
  }

  create(
    tx: TenantPrisma,
    data: { organizationId: string; code: string; name: string; accountId: string; effectiveFrom: Date; createdBy: string },
  ) {
    return tx.postingProfile.create({
      data: {
        organizationId: data.organizationId,
        code: data.code,
        status: 'ACTIVE',
        createdBy: data.createdBy,
        versions: {
          create: {
            versionNumber: 1,
            name: data.name,
            accountId: data.accountId,
            effectiveFrom: data.effectiveFrom,
            changedBy: data.createdBy,
          },
        },
      },
      select: { id: true },
    });
  }

  /**
   * Supersede `previous` from `effectiveFrom`. effectiveTo is EXCLUSIVE, so the previous version is
   * closed AT the new version's effectiveFrom — its last day in force is the day before — which is
   * exactly what the posting_profile_versions non-overlap constraint and the bill resolver
   * (`effectiveFrom <= d < effectiveTo`) need: no gap, no overlap.
   */
  async addVersion(
    tx: TenantPrisma,
    previous: PostingProfileVersion,
    data: { name: string; accountId: string; effectiveFrom: Date; changedBy: string },
  ) {
    await tx.postingProfileVersion.update({
      where: { id: previous.id },
      data: { effectiveTo: data.effectiveFrom },
    });
    return tx.postingProfileVersion.create({
      data: {
        postingProfileId: previous.postingProfileId,
        versionNumber: previous.versionNumber + 1,
        name: data.name,
        accountId: data.accountId,
        effectiveFrom: data.effectiveFrom,
        changedBy: data.changedBy,
      },
    });
  }

  setStatus(tx: TenantPrisma, id: string, status: 'ACTIVE' | 'INACTIVE') {
    return tx.postingProfile.update({ where: { id }, data: { status } });
  }

  async recordAudit(
    tx: TenantPrisma,
    data: {
      organizationId: string;
      userId: string;
      action: string;
      resourceId: string;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
      sourceCommand: string;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        userId: data.userId,
        orgId: data.organizationId,
        action: data.action,
        resource: 'posting-profile',
        resourceId: data.resourceId,
        before: data.before as Prisma.InputJsonValue | undefined,
        after: data.after as Prisma.InputJsonValue | undefined,
        sourceCommand: data.sourceCommand,
      },
    });
  }
}
