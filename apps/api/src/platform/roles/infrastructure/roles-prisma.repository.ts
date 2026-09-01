import { Injectable } from '@nestjs/common';
import { UserStatus } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import type {
  IRolesRepository,
  CreateRoleData,
  UpdateRoleData,
  CreateRoleWithPermissionsData,
  RoleWithPermissionsRecord,
  RoleSummaryRecord,
} from '../domain/interfaces/roles-repository.interface.js';
import { RoleEntity } from '../domain/entities/role.entity.js';

@Injectable()
export class RolesPrismaRepository implements IRolesRepository {
  constructor(private readonly tenancyService: TenancyService) {}

  async findById(id: string): Promise<RoleEntity | null> {
    const prisma = this.tenancyService.getClient();
    const role = await prisma.role.findUnique({ where: { id } });
    return role ? this.toDomain(role) : null;
  }

  async findByIdInOrg(id: string, orgId: string): Promise<RoleEntity | null> {
    const prisma = this.tenancyService.getClient();
    const role = await prisma.role.findFirst({ where: { id, organizationId: orgId } });
    return role ? this.toDomain(role) : null;
  }

  async findAll(orgId: string): Promise<RoleEntity[]> {
    const prisma = this.tenancyService.getClient();
    const roles = await prisma.role.findMany({ where: { organizationId: orgId } });
    return roles.map((r) => this.toDomain(r));
  }

  async nameExists(orgId: string, name: string, excludeId?: string): Promise<boolean> {
    const prisma = this.tenancyService.getClient();
    const found = await prisma.role.findFirst({
      where: {
        organizationId: orgId,
        name,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  }

  async create(data: CreateRoleData): Promise<RoleEntity> {
    const prisma = this.tenancyService.getClient();
    const role = await prisma.role.create({ data });
    return this.toDomain(role);
  }

  async findWithPermissions(id: string, orgId: string): Promise<RoleWithPermissionsRecord | null> {
    const prisma = this.tenancyService.getClient();
    const role = await prisma.role.findFirst({
      where: { id, organizationId: orgId },
      include: {
        rolePermissions: {
          include: { permission: { select: { id: true, action: true, resource: true } } },
        },
      },
    });
    if (!role) return null;
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      kind: role.kind,
      purpose: role.purpose,
      ownerUserId: role.ownerUserId,
      templateRoleId: role.templateRoleId,
      permissions: role.rolePermissions.map((rp) => ({
        id: rp.permission.id,
        action: rp.permission.action,
        resource: rp.permission.resource,
      })),
    };
  }

  async listSummaries(orgId: string): Promise<RoleSummaryRecord[]> {
    const prisma = this.tenancyService.getClient();
    const roles = await prisma.role.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { rolePermissions: true } },
        membershipRoles: { where: { removedAt: null }, select: { id: true } },
      },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      kind: r.kind,
      purpose: r.purpose,
      ownerUserId: r.ownerUserId,
      templateRoleId: r.templateRoleId,
      permissionCount: r._count.rolePermissions,
      memberCount: r.membershipRoles.length,
    }));
  }

  async createWithPermissions(
    data: CreateRoleWithPermissionsData,
  ): Promise<RoleWithPermissionsRecord> {
    const prisma = this.tenancyService.getClient();
    const roleId = await prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          name: data.name,
          description: data.description,
          kind: 'CUSTOM',
          purpose: data.purpose,
          ownerUserId: data.ownerUserId,
          templateRoleId: data.templateRoleId,
          organizationId: data.organizationId,
        },
      });
      if (data.permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: data.permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
        });
      }
      return role.id;
    });

    const created = await this.findWithPermissions(roleId, data.organizationId);
    return created!;
  }

  async update(id: string, orgId: string, data: UpdateRoleData): Promise<void> {
    const prisma = this.tenancyService.getClient();
    await prisma.role.updateMany({ where: { id, organizationId: orgId }, data });
  }

  async replacePermissions(id: string, orgId: string, permissionIds: string[]): Promise<void> {
    const prisma = this.tenancyService.getClient();
    await prisma.$transaction(async (tx) => {
      const role = await tx.role.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
      if (!role) return;
      const desired = new Set(permissionIds);

      const existing = await tx.rolePermission.findMany({
        where: { roleId: id },
        select: { permissionId: true },
      });
      const existingIds = new Set(existing.map((rp) => rp.permissionId));

      const toDelete = [...existingIds].filter((pid) => !desired.has(pid));
      if (toDelete.length > 0) {
        await tx.rolePermission.deleteMany({
          where: { roleId: id, permissionId: { in: toDelete } },
        });
      }

      const toAdd = permissionIds.filter((pid) => !existingIds.has(pid));
      if (toAdd.length > 0) {
        await tx.rolePermission.createMany({
          data: toAdd.map((permissionId) => ({ roleId: id, permissionId })),
        });
      }
    });
  }

  async countActiveAssignments(id: string): Promise<number> {
    const prisma = this.tenancyService.getClient();
    return prisma.organizationMembershipRole.count({
      where: { roleId: id, removedAt: null },
    });
  }

  async delete(id: string, orgId: string): Promise<void> {
    const prisma = this.tenancyService.getClient();
    await prisma.role.deleteMany({ where: { id, organizationId: orgId } });
  }

  async countPermissionsInCatalogue(permissionIds: string[]): Promise<number> {
    if (permissionIds.length === 0) return 0;
    const prisma = this.tenancyService.getClient();
    return prisma.permission.count({ where: { id: { in: permissionIds } } });
  }

  async findImpact(id: string, orgId: string) {
    const prisma = this.tenancyService.getClient();
    const role = await prisma.role.findFirst({ where: { id, organizationId: orgId }, include: { membershipRoles: { where: { removedAt: null }, select: { id: true } }, rolePermissions: { include: { permission: true } } } });
    if (!role) return null;
    return { id: role.id, name: role.name, kind: role.kind, memberCount: role.membershipRoles.length, permissions: role.rolePermissions.map(({ permission }) => ({ id: permission.id, action: permission.action, resource: permission.resource, domain: permission.domain, riskClass: permission.riskClass })) };
  }

  async reassignOwner(id: string, orgId: string, ownerUserId: string): Promise<boolean> {
    const prisma = this.tenancyService.getClient();
    const owner = await prisma.user.findFirst({ where: { id: ownerUserId, organizationId: orgId, status: UserStatus.ACTIVE }, select: { id: true } });
    if (!owner) return false;
    const updated = await prisma.role.updateMany({ where: { id, organizationId: orgId, kind: 'CUSTOM' }, data: { ownerUserId } });
    return updated.count > 0;
  }

  async addAccessReview(data: { orgId: string; roleId: string; reviewerUserId: string; decision: 'CONFIRMED' | 'CHANGES_REQUIRED'; notes?: string }): Promise<void> {
    const prisma = this.tenancyService.getClient();
    await prisma.roleAccessReview.create({ data: { organizationId: data.orgId, roleId: data.roleId, reviewerUserId: data.reviewerUserId, decision: data.decision, notes: data.notes } });
  }

  async listAccessReviews(id: string, orgId: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.roleAccessReview.findMany({ where: { roleId: id, organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  private toDomain(raw: {
    id: string;
    name: string;
    description: string | null;
    organizationId: string;
    createdAt: Date;
    updatedAt: Date;
  }): RoleEntity {
    return new RoleEntity(
      raw.id,
      raw.name,
      raw.description,
      raw.organizationId,
      raw.createdAt,
      raw.updatedAt,
    );
  }
}
