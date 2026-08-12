import { Injectable } from '@nestjs/common';
import { PrismaClient, Project, ProjectRole, Prisma } from '@prisma/client';

export const PROJECT_FULL_INCLUDE = {
  members: {
    where: { removedAt: null },
    include: { roles: { where: { removedAt: null } }, user: { select: { id: true, firstName: true, lastName: true, email: true } } },
  },
  suspensions: { where: { resumedAt: null }, take: 1 },
} satisfies Prisma.ProjectInclude;

export type ProjectFull = Prisma.ProjectGetPayload<{ include: typeof PROJECT_FULL_INCLUDE }>;

@Injectable()
export class ProjectPrismaRepository {
  // ─── Queries ─────────────────────────────────────────────────────────────────

  async findAll(
    prisma: PrismaClient,
    organizationId: string,
    status?: string,
    userId?: string,
  ): Promise<Project[]> {
    return prisma.project.findMany({
      where: {
        organizationId,
        ...(userId ? { members: { some: { userId, removedAt: null } } } : {}),
        ...(status ? { status: status as Prisma.EnumProjectStatusFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(prisma: PrismaClient, organizationId: string, id: string): Promise<ProjectFull | null> {
    return prisma.project.findFirst({
      where: { id, organizationId },
      include: PROJECT_FULL_INCLUDE,
    });
  }

  async findByCode(prisma: PrismaClient, organizationId: string, code: string): Promise<Project | null> {
    return prisma.project.findUnique({ where: { organizationId_code: { organizationId, code } } });
  }

  // ─── Commands ────────────────────────────────────────────────────────────────

  async create(prisma: PrismaClient, data: Prisma.ProjectUncheckedCreateInput): Promise<Project> {
    return prisma.project.create({ data });
  }

  async update(
    prisma: PrismaClient,
    id: string,
    data: Prisma.ProjectUncheckedUpdateInput,
  ): Promise<Project> {
    return prisma.project.update({ where: { id }, data });
  }

  // ─── Suspension ──────────────────────────────────────────────────────────────

  async createSuspension(
    prisma: PrismaClient,
    data: Prisma.ProjectSuspensionUncheckedCreateInput,
  ) {
    return prisma.projectSuspension.create({ data });
  }

  async resolveActiveSuspension(
    prisma: PrismaClient,
    projectId: string,
    resumedBy: string,
  ) {
    return prisma.projectSuspension.updateMany({
      where: { projectId, resumedAt: null },
      data: { resumedAt: new Date(), resumedBy },
    });
  }

  async findActiveSuspension(prisma: PrismaClient, projectId: string) {
    return prisma.projectSuspension.findFirst({ where: { projectId, resumedAt: null } });
  }

  // ─── Members ─────────────────────────────────────────────────────────────────

  async findActiveMember(prisma: PrismaClient, projectId: string, userId: string) {
    return prisma.projectMember.findFirst({
      where: { projectId, userId, removedAt: null },
      include: { roles: { where: { removedAt: null } } },
    });
  }

  async findAllMembers(prisma: PrismaClient, projectId: string) {
    return prisma.projectMember.findMany({
      where: { projectId, removedAt: null },
      include: {
        roles: { where: { removedAt: null } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async createMember(
    prisma: PrismaClient,
    data: Prisma.ProjectMemberUncheckedCreateInput,
  ) {
    return prisma.projectMember.create({ data });
  }

  async removeMember(
    prisma: PrismaClient,
    memberId: string,
    removedBy: string,
  ) {
    return prisma.projectMember.update({
      where: { id: memberId },
      data: { removedAt: new Date(), removedBy },
    });
  }

  async addMemberRoles(
    prisma: PrismaClient,
    memberId: string,
    roles: string[],
    assignedBy: string,
  ) {
    return prisma.projectMemberRole.createMany({
      data: roles.map((role) => ({ memberId, role: role as ProjectRole, assignedBy })),
    });
  }
}
