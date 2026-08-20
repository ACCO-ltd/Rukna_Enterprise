/**
 * Refresh admin permissions.
 *
 * Permissions live as rows and are linked to roles via role_permissions. New permissions added
 * to `@erp/types` (e.g. ADR-025's manage:district) reach NEW tenants automatically at provision
 * time, but an ALREADY-provisioned database keeps whatever set of links it had — so a freshly
 * added permission is missing until the grant is re-run.
 *
 * This re-runs `grantAllPermissionsToRole` for the org's ADMIN role: it upserts every current
 * permission and links any that are not yet granted. Idempotent (skipDuplicates), safe to run
 * repeatedly.
 *
 * Usage:  npx tsx prisma/seeds/refresh-admin-permissions.seed.ts
 * Requires DATABASE_URL pointing to the tenant database. ORG_SLUG defaults to "acco",
 * ADMIN_ROLE defaults to "ADMIN".
 */

import { PrismaClient } from '@prisma/client';

import { grantAllPermissionsToRole } from '../../scripts/tenant-access.js';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ORG_SLUG ?? 'acco';
const ADMIN_ROLE = process.env.ADMIN_ROLE ?? 'ADMIN';

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`Organization with slug "${ORG_SLUG}" not found.`);

  const role = await prisma.role.findFirst({
    where: { organizationId: org.id, name: ADMIN_ROLE },
  });
  if (!role) throw new Error(`Role "${ADMIN_ROLE}" not found for org ${ORG_SLUG}.`);

  const before = await prisma.rolePermission.count({ where: { roleId: role.id } });
  const total = await grantAllPermissionsToRole(prisma, role.id);
  const after = await prisma.rolePermission.count({ where: { roleId: role.id } });

  console.log(`  ✓ ${ADMIN_ROLE} (${ORG_SLUG}): ${after - before} new grant(s); ${after}/${total} permissions now linked`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
