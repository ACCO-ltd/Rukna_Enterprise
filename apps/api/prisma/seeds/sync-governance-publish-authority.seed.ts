/**
 * Synchronize publish:workflow authority to an already-provisioned tenant (ADR-027, item 6).
 *
 * New tenants get the governed CFO + Governance Publisher SYSTEM roles at provision time
 * (tenant-provision.ts). An ALREADY-provisioned database (the live ACCO tenant) only has ADMIN,
 * so publish:workflow is held by nobody but ADMIN. This back-fill:
 *
 *   1. Upserts the two governed SYSTEM roles (CFO, GOVERNANCE_PUBLISHER) and links their permission
 *      sets — including publish:workflow — via the same idempotent seeder used at provision.
 *   2. Ensures the ADMIN role also has publish:workflow + view:governance-impact linked (ADMIN gets
 *      the whole catalogue, but a tenant provisioned before these rows existed may be missing them
 *      until refresh-admin-permissions runs; this makes the publish authority explicit regardless).
 *
 * Additive and idempotent (skipDuplicates, never removes a link). Safe to run repeatedly.
 *
 * Usage:  npx tsx prisma/seeds/sync-governance-publish-authority.seed.ts
 * Requires DATABASE_URL pointing to the tenant database. ORG_SLUG defaults to "acco",
 * ADMIN_ROLE defaults to "ADMIN".
 */

import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@erp/types';

import { seedGovernedSystemRoles } from '../../scripts/governed-roles.js';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ORG_SLUG ?? 'acco';
const ADMIN_ROLE = process.env.ADMIN_ROLE ?? 'ADMIN';

const ADMIN_GRANTS = [PERMISSIONS.workflowsPublish, PERMISSIONS.governanceImpactView] as const;

async function ensureAdminGrants(organizationId: string): Promise<number> {
  const role = await prisma.role.findFirst({
    where: { organizationId, name: ADMIN_ROLE },
    select: { id: true },
  });
  if (!role) throw new Error(`Role "${ADMIN_ROLE}" not found for org ${ORG_SLUG}.`);

  const before = await prisma.rolePermission.count({ where: { roleId: role.id } });
  for (const key of ADMIN_GRANTS) {
    const separator = key.indexOf(':');
    const action = key.slice(0, separator);
    const resource = key.slice(separator + 1);
    const permission = await prisma.permission.upsert({
      where: { action_resource: { action, resource } },
      create: { action, resource, description: `${action}:${resource}` },
      update: {},
      select: { id: true },
    });
    await prisma.rolePermission.createMany({
      data: [{ roleId: role.id, permissionId: permission.id }],
      skipDuplicates: true,
    });
  }
  const after = await prisma.rolePermission.count({ where: { roleId: role.id } });
  return after - before;
}

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`Organization with slug "${ORG_SLUG}" not found.`);

  const governed = await seedGovernedSystemRoles(prisma, org.id);
  for (const role of governed) {
    console.log(
      `  ✓ ${role.roleName} (${ORG_SLUG}): ${role.grantsAdded} new grant(s); ` +
        `${role.permissionsLinked} permissions now linked`,
    );
  }

  const adminAdded = await ensureAdminGrants(org.id);
  console.log(`  ✓ ${ADMIN_ROLE} (${ORG_SLUG}): ${adminAdded} publish-authority grant(s) added`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
