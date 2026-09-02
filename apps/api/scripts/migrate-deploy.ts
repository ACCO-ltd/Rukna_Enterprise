#!/usr/bin/env tsx
/**
 * Release migration runner.
 *
 * Applies pending migrations to the platform registry, then to every tenant
 * database listed in it. Intended to run once per deploy, before the new
 * version starts serving traffic.
 *
 * `prisma migrate deploy` only ever applies existing migrations — it never
 * generates one and never resets — so this is safe to re-run.
 */
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as PlatformPrismaClient } from '../src/generated/platform-client/index.js';
import { seedDistricts } from '../prisma/seeds/districts.js';
import { grantAllPermissionsToRole } from './tenant-access.js';

const PLATFORM_DB_URL = process.env.PLATFORM_DATABASE_URL;
if (!PLATFORM_DB_URL) {
  console.error('PLATFORM_DATABASE_URL env var is required');
  process.exit(1);
}

/** Tenants in these states are not serving traffic and are skipped. */
const SKIPPED_STATUSES = new Set(['TERMINATED']);

function migrate(schema: string, databaseUrlVar: string, url: string): void {
  execFileSync('npx', ['prisma', 'migrate', 'deploy', `--schema=${schema}`], {
    env: { ...process.env, [databaseUrlVar]: url },
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

/**
 * Install the district registry on a tenant that has none.
 *
 * Strictly a backfill. Tenants provisioned since `tenant-provision` started seeding already
 * have it, and the empty-registry guard is what keeps this from being an opinion: a tenant
 * that has curated its own districts — removed the Banaadir set, added its own city — is left
 * alone forever, because it is no longer empty.
 *
 * Never fatal. A tenant DB migrated before its organization row exists has nothing to seed
 * against, and a release must not fail over optional reference data.
 */
async function backfillDistricts(slug: string, dbUrl: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    if ((await prisma.district.count()) > 0) return;

    const org = await prisma.organization.findFirst({ where: { slug } });
    if (!org) return;

    const { created } = await seedDistricts(prisma, org.id);
    if (created > 0) console.log(`  ✓ District registry seeded (${created})`);
  } catch (error) {
    console.warn(
      `  ! District backfill skipped for '${slug}': ${error instanceof Error ? error.message : error}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Re-link every current permission to the tenant's ADMIN role.
 *
 * Permissions are rows, linked to roles through `role_permissions`. A new one added to
 * `@erp/types` reaches a NEW tenant automatically, because provisioning grants the whole set —
 * but an already-provisioned database keeps the links it had. So the permission exists, the
 * feature ships, and the administrator is told to ask an administrator. `manage:project-type`
 * did exactly that on the live tenant, and `manage:district` before it.
 *
 * Unlike the district backfill this runs on every deploy rather than only when empty: its whole
 * job is to notice what is new, and `grantAllPermissionsToRole` skips duplicates.
 *
 * The caveat worth stating: this cannot tell "never granted" from "deliberately revoked", so a
 * permission removed from ADMIN by hand comes back. That is consistent with how the model is
 * built — ADMIN is the role provisioning gives everything to, and separation of duties is
 * expressed through the governed roles seeded beside it (ADR-027), not by thinning ADMIN.
 *
 * Never fatal. A tenant with no ADMIN role yet has nothing to grant, and a release must not
 * fail over it.
 */
async function refreshAdminPermissions(slug: string, dbUrl: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const org = await prisma.organization.findFirst({ where: { slug } });
    if (!org) return;

    const role = await prisma.role.findFirst({
      where: { organizationId: org.id, name: 'ADMIN' },
    });
    if (!role) return;

    const before = await prisma.rolePermission.count({ where: { roleId: role.id } });
    await grantAllPermissionsToRole(prisma, role.id);
    const after = await prisma.rolePermission.count({ where: { roleId: role.id } });

    if (after > before) console.log(`  ✓ ADMIN permissions refreshed (+${after - before})`);
  } catch (error) {
    console.warn(
      `  ! Permission refresh skipped for '${slug}': ${error instanceof Error ? error.message : error}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  console.log('\n── Platform registry ──');
  migrate('prisma-platform/schema.prisma', 'PLATFORM_DATABASE_URL', PLATFORM_DB_URL!);

  const platformPrisma = new PlatformPrismaClient({
    datasources: { db: { url: PLATFORM_DB_URL } },
  });

  const tenants = await platformPrisma.tenant.findMany({ orderBy: { slug: 'asc' } });
  await platformPrisma.$disconnect();

  const targets = tenants.filter((t) => !SKIPPED_STATUSES.has(t.status));
  console.log(`\n${targets.length} tenant database(s) to migrate`);

  const failures: string[] = [];

  for (const tenant of targets) {
    console.log(`\n── Tenant: ${tenant.slug} (${tenant.status}) ──`);
    try {
      migrate('prisma/schema.prisma', 'DATABASE_URL', tenant.dbUrl);
      await backfillDistricts(tenant.slug, tenant.dbUrl);
      await refreshAdminPermissions(tenant.slug, tenant.dbUrl);
    } catch {
      // Keep going: one broken tenant must not block migrations for the rest.
      console.error(`  ✗ Migration failed for tenant '${tenant.slug}'`);
      failures.push(tenant.slug);
    }
  }

  if (failures.length > 0) {
    console.error(`\n✗ Migration failed for ${failures.length} tenant(s): ${failures.join(', ')}`);
    process.exit(1);
  }

  console.log('\n✓ All migrations applied');
}

main().catch((err: unknown) => {
  console.error('Migration run failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
