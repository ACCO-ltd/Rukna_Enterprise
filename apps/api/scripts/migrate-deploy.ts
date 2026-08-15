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
import { PrismaClient as PlatformPrismaClient } from '../src/generated/platform-client/index.js';

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
