#!/usr/bin/env tsx
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { PERMISSION_DEFINITIONS } from '@erp/types';
import { PrismaClient as PlatformPrismaClient } from '../src/generated/platform-client/index.js';
import {
  ensureUserMembershipRole,
  grantAllPermissionsToRole,
} from './tenant-access.js';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const slug = values.slug;
const dryRun = values['dry-run'] ?? false;
const platformDatabaseUrl = process.env.PLATFORM_DATABASE_URL;

if (!slug || !platformDatabaseUrl) {
  console.error(
    'Usage: pnpm tenant:repair-access --slug=acco [--dry-run] ' +
      '(PLATFORM_DATABASE_URL is required)',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const platform = new PlatformPrismaClient({
    datasources: { db: { url: platformDatabaseUrl } },
  });

  try {
    const tenant = await platform.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`Tenant '${slug}' was not found`);

    const prisma = new PrismaClient({ datasources: { db: { url: tenant.dbUrl } } });
    try {
      const users = await prisma.user.findMany({
        include: {
          memberships: { include: { roles: true } },
          userRoles: {
            include: {
              role: {
                include: {
                  rolePermissions: { include: { permission: true } },
                },
              },
            },
          },
        },
        orderBy: { email: 'asc' },
      });

      let missingMemberships = 0;
      let missingMembershipRoles = 0;
      let adminRolesNeedingSync = 0;
      let adminRolesSynchronized = 0;

      for (const user of users) {
        const membership = user.memberships.find(
          (candidate) => candidate.organizationId === user.organizationId,
        );
        if (!membership) missingMemberships += 1;

        for (const assignment of user.userRoles) {
          const hasMembershipRole = membership?.roles.some(
            (candidate) => candidate.roleId === assignment.roleId && candidate.removedAt === null,
          );
          if (!hasMembershipRole) missingMembershipRoles += 1;

          if (!dryRun) {
            await ensureUserMembershipRole(prisma, {
              organizationId: user.organizationId,
              userId: user.id,
              roleId: assignment.roleId,
              isDefault: true,
            });
          }

          if (assignment.role.name === 'ADMIN') {
            const assignedPermissionKeys = new Set(
              assignment.role.rolePermissions.map(
                ({ permission }) => `${permission.action}:${permission.resource}`,
              ),
            );
            const needsSync = PERMISSION_DEFINITIONS.some(
              ({ action, resource }) => !assignedPermissionKeys.has(`${action}:${resource}`),
            );
            if (needsSync) adminRolesNeedingSync += 1;
            if (!dryRun) {
              await grantAllPermissionsToRole(prisma, assignment.roleId);
              adminRolesSynchronized += 1;
            }
          }
        }

        if (!membership && user.userRoles.length === 0 && !dryRun) {
          await prisma.organizationMembership.create({
            data: {
              organizationId: user.organizationId,
              userId: user.id,
              status: 'ACTIVE',
              isDefault: true,
            },
          });
        }
      }

      console.log(`${dryRun ? 'Dry run' : 'Repair'} complete for tenant '${slug}'`);
      console.log(`  Users inspected: ${users.length}`);
      console.log(`  Missing memberships: ${missingMemberships}`);
      console.log(`  Missing membership roles: ${missingMembershipRoles}`);
      console.log(
        `  ADMIN roles ${dryRun ? 'requiring permission sync' : 'synchronized'}: ` +
          `${dryRun ? adminRolesNeedingSync : adminRolesSynchronized}`,
      );
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    await platform.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown repair failure';
  console.error(`Access repair failed: ${message}`);
  process.exitCode = 1;
});
