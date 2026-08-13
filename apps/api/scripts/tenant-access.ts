import type { Prisma } from '@prisma/client';
import { PERMISSION_DEFINITIONS } from '@erp/types';

type TenantAccessClient = Pick<
  Prisma.TransactionClient,
  'organizationMembership' | 'organizationMembershipRole' | 'permission' | 'rolePermission' | 'userRole'
>;

export interface SeedUserAccessResult {
  membershipId: string;
  permissionsAssigned: number;
}

export async function ensureUserMembershipRole(
  prisma: TenantAccessClient,
  input: { organizationId: string; userId: string; roleId: string; isDefault?: boolean },
): Promise<string> {
  const membership = await prisma.organizationMembership.upsert({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
    create: {
      organizationId: input.organizationId,
      userId: input.userId,
      status: 'ACTIVE',
      isDefault: input.isDefault ?? true,
    },
    update: {},
  });

  const membershipRole = await prisma.organizationMembershipRole.findFirst({
    where: { membershipId: membership.id, roleId: input.roleId, removedAt: null },
    select: { id: true },
  });
  if (!membershipRole) {
    await prisma.organizationMembershipRole.create({
      data: {
        membershipId: membership.id,
        roleId: input.roleId,
        assignedBy: input.userId,
      },
    });
  }

  // Keep the legacy assignment populated until authentication fully migrates to
  // OrganizationMembershipRole. The composite key makes this safe to repeat.
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: input.userId, roleId: input.roleId } },
    create: { userId: input.userId, roleId: input.roleId },
    update: {},
  });

  return membership.id;
}

export async function grantAllPermissionsToRole(
  prisma: TenantAccessClient,
  roleId: string,
): Promise<number> {

  const permissionIds: string[] = [];
  for (const definition of PERMISSION_DEFINITIONS) {
    const permission = await prisma.permission.upsert({
      where: {
        action_resource: {
          action: definition.action,
          resource: definition.resource,
        },
      },
      create: {
        action: definition.action,
        resource: definition.resource,
        description: definition.description,
      },
      update: { description: definition.description },
      select: { id: true },
    });
    permissionIds.push(permission.id);
  }

  await prisma.rolePermission.createMany({
    data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
    skipDuplicates: true,
  });

  return permissionIds.length;
}

/**
 * Establishes the complete ADMIN access graph required by JwtStrategy and AuthService.
 * The operation is idempotent so it can be shared by provisioning and repair tooling.
 */
export async function seedUserAccess(
  prisma: TenantAccessClient,
  input: { organizationId: string; userId: string; roleId: string; isDefault?: boolean },
): Promise<SeedUserAccessResult> {
  const membershipId = await ensureUserMembershipRole(prisma, input);
  const permissionsAssigned = await grantAllPermissionsToRole(prisma, input.roleId);
  return { membershipId, permissionsAssigned };
}
