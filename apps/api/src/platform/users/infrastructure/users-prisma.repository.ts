import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { UserStatus, MembershipStatus } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import type {
  IUsersRepository,
  CreateUserData,
  UpdateUserData,
  CreateUserWithMembershipData,
  UserWithRolesRecord,
} from '../domain/interfaces/users-repository.interface.js';
import { UserEntity } from '../domain/entities/user.entity.js';

// A membership plus its live role assignments, joined to the role for name display.
const membershipWithRoles = {
  where: { removedAt: null },
  include: {
    role: { select: { id: true, name: true } },
  },
} satisfies Prisma.OrganizationMembershipRoleFindManyArgs;

@Injectable()
export class UsersPrismaRepository implements IUsersRepository {
  constructor(private readonly tenancyService: TenancyService) {}

  async findById(id: string, organizationId: string): Promise<UserEntity | null> {
    const prisma = this.tenancyService.getClient();
    const user = await prisma.user.findFirst({ where: { id, organizationId } });
    return user ? this.toDomain(user) : null;
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    const prisma = this.tenancyService.getClient();
    const user = await prisma.user.findUnique({ where: { email } });
    return user ? this.toDomain(user) : null;
  }

  async findAll(orgId: string): Promise<UserEntity[]> {
    const prisma = this.tenancyService.getClient();
    const users = await prisma.user.findMany({ where: { organizationId: orgId } });
    return users.map((u) => this.toDomain(u));
  }

  async create(data: CreateUserData): Promise<UserEntity> {
    const prisma = this.tenancyService.getClient();
    const user = await prisma.user.create({ data });
    return this.toDomain(user);
  }

  async update(id: string, data: UpdateUserData): Promise<UserEntity> {
    const prisma = this.tenancyService.getClient();
    const user = await prisma.user.update({ where: { id }, data });
    return this.toDomain(user);
  }

  async delete(id: string): Promise<void> {
    const prisma = this.tenancyService.getClient();
    await prisma.user.delete({ where: { id } });
  }

  // ─── Read model ─────────────────────────────────────────────────────────────

  async findByOrganizationWithRoles(orgId: string): Promise<UserWithRolesRecord[]> {
    const prisma = this.tenancyService.getClient();
    const users = await prisma.user.findMany({
      where: { organizationId: orgId },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      include: {
        memberships: {
          where: { organizationId: orgId },
          include: { roles: membershipWithRoles },
        },
      },
    });
    return users.map((u) => this.toRolesRecord(u));
  }

  async findByIdWithRoles(id: string, orgId: string): Promise<UserWithRolesRecord | null> {
    const prisma = this.tenancyService.getClient();
    const user = await prisma.user.findFirst({
      where: { id, organizationId: orgId },
      include: {
        memberships: {
          where: { organizationId: orgId },
          include: { roles: membershipWithRoles },
        },
      },
    });
    return user ? this.toRolesRecord(user) : null;
  }

  // ─── Provisioning + role administration ─────────────────────────────────────

  async createWithMembership(data: CreateUserWithMembershipData): Promise<UserWithRolesRecord> {
    const prisma = this.tenancyService.getClient();
    const userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          passwordHash: data.passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          status: UserStatus.ACTIVE,
          organizationId: data.organizationId,
        },
      });
      const membership = await tx.organizationMembership.create({
        data: {
          organizationId: data.organizationId,
          userId: user.id,
          status: MembershipStatus.ACTIVE,
          isDefault: true,
        },
      });
      if (data.roleIds.length > 0) {
        await tx.organizationMembershipRole.createMany({
          data: data.roleIds.map((roleId) => ({
            membershipId: membership.id,
            roleId,
            assignedBy: data.actorUserId,
          })),
        });
      }
      return user.id;
    });

    const created = await this.findByIdWithRoles(userId, data.organizationId);
    // Non-null: we just created it inside the same org.
    return created!;
  }

  async updateStatus(id: string, orgId: string, status: UserStatus): Promise<void> {
    const prisma = this.tenancyService.getClient();
    await prisma.user.updateMany({ where: { id, organizationId: orgId }, data: { status } });
  }

  async updatePassword(id: string, orgId: string, passwordHash: string): Promise<void> {
    const prisma = this.tenancyService.getClient();
    await prisma.user.updateMany({ where: { id, organizationId: orgId }, data: { passwordHash } });
  }

  async deactivate(id: string, orgId: string, actorUserId: string): Promise<void> {
    const prisma = this.tenancyService.getClient();
    await prisma.$transaction([
      prisma.user.updateMany({
        where: { id, organizationId: orgId },
        data: { status: UserStatus.INACTIVE },
      }),
      prisma.organizationMembership.updateMany({
        where: { userId: id, organizationId: orgId },
        data: {
          status: MembershipStatus.SUSPENDED,
          removedAt: new Date(),
          removedBy: actorUserId,
        },
      }),
    ]);
  }

  async reactivate(id: string, orgId: string): Promise<void> {
    const prisma = this.tenancyService.getClient();
    await prisma.$transaction([
      prisma.user.updateMany({
        where: { id, organizationId: orgId },
        data: { status: UserStatus.ACTIVE },
      }),
      prisma.organizationMembership.updateMany({
        where: { userId: id, organizationId: orgId },
        data: { status: MembershipStatus.ACTIVE, removedAt: null, removedBy: null },
      }),
    ]);
  }

  async replaceMembershipRoles(
    id: string,
    orgId: string,
    roleIds: string[],
    actorUserId: string,
  ): Promise<void> {
    const prisma = this.tenancyService.getClient();
    await prisma.$transaction(async (tx) => {
      const membership = await tx.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: id } },
        include: { roles: true },
      });
      if (!membership) return;

      const desired = new Set(roleIds);
      const live = membership.roles.filter((r) => r.removedAt === null);
      const liveRoleIds = new Set(live.map((r) => r.roleId));

      // Soft-remove live assignments no longer desired.
      const toRemove = live.filter((r) => !desired.has(r.roleId)).map((r) => r.id);
      if (toRemove.length > 0) {
        await tx.organizationMembershipRole.updateMany({
          where: { id: { in: toRemove } },
          data: { removedAt: new Date() },
        });
      }

      // Un-remove previously-removed assignments that are desired again.
      const removed = membership.roles.filter((r) => r.removedAt !== null);
      const toRestore = removed
        .filter((r) => desired.has(r.roleId) && !liveRoleIds.has(r.roleId))
        .map((r) => r.id);
      if (toRestore.length > 0) {
        await tx.organizationMembershipRole.updateMany({
          where: { id: { in: toRestore } },
          data: { removedAt: null, assignedBy: actorUserId, assignedAt: new Date() },
        });
      }

      // Add brand-new assignments.
      const known = new Set(membership.roles.map((r) => r.roleId));
      const toAdd = roleIds.filter((roleId) => !known.has(roleId));
      if (toAdd.length > 0) {
        await tx.organizationMembershipRole.createMany({
          data: toAdd.map((roleId) => ({
            membershipId: membership.id,
            roleId,
            assignedBy: actorUserId,
          })),
        });
      }
    });
  }

  async countRolesInOrg(orgId: string, roleIds: string[]): Promise<number> {
    if (roleIds.length === 0) return 0;
    const prisma = this.tenancyService.getClient();
    return prisma.role.count({ where: { organizationId: orgId, id: { in: roleIds } } });
  }

  private toDomain(raw: {
    id: string;
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    status: string;
    organizationId: string;
    createdAt: Date;
    updatedAt: Date;
  }): UserEntity {
    return new UserEntity(
      raw.id,
      raw.email,
      raw.passwordHash,
      raw.firstName,
      raw.lastName,
      raw.status as UserStatus,
      raw.organizationId,
      raw.createdAt,
      raw.updatedAt,
    );
  }

  private toRolesRecord(raw: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    status: string;
    memberships: {
      status: string;
      roles: { role: { id: string; name: string } }[];
    }[];
  }): UserWithRolesRecord {
    const membership = raw.memberships[0];
    return {
      id: raw.id,
      email: raw.email,
      firstName: raw.firstName,
      lastName: raw.lastName,
      status: raw.status as UserStatus,
      membershipStatus: membership ? (membership.status as MembershipStatus) : null,
      roles: membership ? membership.roles.map((r) => r.role) : [],
    };
  }
}
