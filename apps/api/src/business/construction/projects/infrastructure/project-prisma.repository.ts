import { Injectable } from '@nestjs/common';
import { PrismaClient, Project, ProjectRole, Prisma } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export const PROJECT_FULL_INCLUDE = {
  members: {
    where: { removedAt: null },
    include: {
      roles: { where: { removedAt: null } },
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  },
  suspensions: { where: { resumedAt: null }, take: 1 },
  // Project type (PTD1-PTD5): the read model surfaces the scalar `category` (comes for free) plus
  // the assigned subtype's id/name/category so the UI can render + edit the classification.
  subtype: { select: { id: true, name: true, category: true, status: true } },
} satisfies Prisma.ProjectInclude;

export type ProjectFull = Prisma.ProjectGetPayload<{ include: typeof PROJECT_FULL_INCLUDE }>;

const PROJECT_LIST_INCLUDE = {
  members: {
    where: { removedAt: null, roles: { some: { role: 'PROJECT_MANAGER', removedAt: null } } },
    take: 1,
    select: { user: { select: { firstName: true, lastName: true } } },
  },
  suspensions: { where: { resumedAt: null }, take: 1, select: { id: true } },
  contracts: {
    where: {
      contractKind: 'CLIENT_CONTRACT',
      status: 'ACTIVE',
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { contractValue: true, currency: true },
  },
} satisfies Prisma.ProjectInclude;

export type ProjectListRecord = Prisma.ProjectGetPayload<{ include: typeof PROJECT_LIST_INCLUDE }>;

const PROJECT_WORKSPACE_SUMMARY_INCLUDE = {
  members: {
    where: { removedAt: null },
    include: {
      roles: { where: { removedAt: null } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  boq: {
    select: {
      id: true,
      versions: { select: { status: true } },
    },
  },
  contracts: {
    where: {
      contractKind: 'CLIENT_CONTRACT',
      status: { notIn: ['CLOSED', 'CANCELLED', 'TERMINATED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      contractNumber: true,
      contractValue: true,
      currency: true,
      status: true,
      startDate: true,
      expectedEndDate: true,
    },
  },
  suspensions: { where: { resumedAt: null }, take: 1, select: { id: true } },
} satisfies Prisma.ProjectInclude;

export type ProjectWorkspaceSummaryRecord = Prisma.ProjectGetPayload<{
  include: typeof PROJECT_WORKSPACE_SUMMARY_INCLUDE;
}>;

// ADR-019 CONST-PLC-005/009 — exactly the facts the readiness policy reads: the assigned client's
// status, the effective (non-terminal) client contract's status + start date, whether a BOQ version
// is baselined, and the active member count. Scalars (status, commercialModel, dates, clientId)
// come with the include.
const PROJECT_READINESS_INCLUDE = {
  client: { select: { status: true } },
  boq: { select: { versions: { select: { status: true } } } },
  contracts: {
    where: {
      contractKind: 'CLIENT_CONTRACT',
      status: { notIn: ['CLOSED', 'CANCELLED', 'TERMINATED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { status: true, startDate: true },
  },
  members: { where: { removedAt: null }, select: { id: true } },
} satisfies Prisma.ProjectInclude;

export type ProjectReadinessRecord = Prisma.ProjectGetPayload<{
  include: typeof PROJECT_READINESS_INCLUDE;
}>;

@Injectable()
export class ProjectPrismaRepository {
  // ─── Queries ─────────────────────────────────────────────────────────────────

  async findAll(
    prisma: TenantPrisma,
    organizationId: string,
    status?: string,
    userId?: string,
  ): Promise<ProjectListRecord[]> {
    return prisma.project.findMany({
      where: {
        organizationId,
        ...(userId ? { members: { some: { userId, removedAt: null } } } : {}),
        ...(status ? { status: status as Prisma.EnumProjectStatusFilter } : {}),
      },
      include: PROJECT_LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(
    prisma: TenantPrisma,
    organizationId: string,
    id: string,
  ): Promise<ProjectFull | null> {
    return prisma.project.findFirst({
      where: { id, organizationId },
      include: PROJECT_FULL_INCLUDE,
    });
  }

  async findWorkspaceSummary(
    prisma: TenantPrisma,
    organizationId: string,
    id: string,
  ): Promise<ProjectWorkspaceSummaryRecord | null> {
    return prisma.project.findFirst({
      where: { id, organizationId },
      include: PROJECT_WORKSPACE_SUMMARY_INCLUDE,
    });
  }

  async findReadinessSnapshot(
    prisma: TenantPrisma,
    organizationId: string,
    id: string,
  ): Promise<ProjectReadinessRecord | null> {
    return prisma.project.findFirst({
      where: { id, organizationId },
      include: PROJECT_READINESS_INCLUDE,
    });
  }

  async findRecentProjectActivity(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.auditLog.findMany({
      where: { orgId: organizationId, resource: 'Project', resourceId: projectId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        action: true,
        sourceCommand: true,
        createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async findByCode(
    prisma: TenantPrisma,
    organizationId: string,
    code: string,
  ): Promise<Project | null> {
    return prisma.project.findUnique({ where: { organizationId_code: { organizationId, code } } });
  }

  // ─── Commands ────────────────────────────────────────────────────────────────

  async create(prisma: TenantPrisma, data: Prisma.ProjectUncheckedCreateInput): Promise<Project> {
    return prisma.project.create({ data });
  }

  /**
   * ADR-025 — allocate a project code `{shortCode}-{districtCode}-{YY}-{seq4}`
   * (e.g. `ACCO-WBR-26-0065`). The sequence is scoped per (org, year): the number
   * counts every project the org started that year, across all districts, and resets
   * with the year. The increment is atomic (upsert), so a concurrent create cannot
   * hand out the same number twice.
   */
  async allocateCode(
    prisma: TenantPrisma,
    organizationId: string,
    year: number,
    shortCode: string,
    districtCode: string,
  ): Promise<string> {
    const sequence = await prisma.projectCodeSequence.upsert({
      where: { organizationId_year: { organizationId, year } },
      create: { organizationId, year, nextValue: 2 },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });
    const allocated = sequence.nextValue - 1;
    const yy = String(year).slice(-2);
    return `${shortCode}-${districtCode}-${yy}-${String(allocated).padStart(4, '0')}`;
  }

  async update(
    prisma: TenantPrisma,
    id: string,
    data: Prisma.ProjectUncheckedUpdateInput,
  ): Promise<Project> {
    return prisma.project.update({ where: { id }, data });
  }

  // ─── Suspension ──────────────────────────────────────────────────────────────

  async createSuspension(prisma: TenantPrisma, data: Prisma.ProjectSuspensionUncheckedCreateInput) {
    return prisma.projectSuspension.create({ data });
  }

  async resolveActiveSuspension(prisma: TenantPrisma, projectId: string, resumedBy: string) {
    return prisma.projectSuspension.updateMany({
      where: { projectId, resumedAt: null },
      data: { resumedAt: new Date(), resumedBy },
    });
  }

  async findActiveSuspension(prisma: TenantPrisma, projectId: string) {
    return prisma.projectSuspension.findFirst({ where: { projectId, resumedAt: null } });
  }

  // ─── Members ─────────────────────────────────────────────────────────────────

  async findActiveMember(prisma: TenantPrisma, projectId: string, userId: string) {
    return prisma.projectMember.findFirst({
      where: { projectId, userId, removedAt: null },
      include: { roles: { where: { removedAt: null } } },
    });
  }

  async findAllMembers(prisma: TenantPrisma, projectId: string) {
    return prisma.projectMember.findMany({
      where: { projectId, removedAt: null },
      include: {
        roles: { where: { removedAt: null } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async createMember(prisma: TenantPrisma, data: Prisma.ProjectMemberUncheckedCreateInput) {
    return prisma.projectMember.create({ data });
  }

  async removeMember(prisma: TenantPrisma, memberId: string, removedBy: string) {
    return prisma.projectMember.update({
      where: { id: memberId },
      data: { removedAt: new Date(), removedBy },
    });
  }

  async addMemberRoles(
    prisma: TenantPrisma,
    memberId: string,
    roles: string[],
    assignedBy: string,
  ) {
    return prisma.projectMemberRole.createMany({
      data: roles.map((role) => ({ memberId, role: role as ProjectRole, assignedBy })),
    });
  }

  /** Closes every currently-active role row for a member (versioned edit — no hard delete). */
  async deactivateMemberRoles(prisma: TenantPrisma, memberId: string) {
    return prisma.projectMemberRole.updateMany({
      where: { memberId, removedAt: null },
      data: { removedAt: new Date() },
    });
  }
}
